#!/usr/bin/env node
// 从**真跑起来的** @hulianui/mcp 抓取 adapter 的 fixture 与 contract 引脚。
//
// 存在的理由：上一版 fixture 是手写的 —— 它描述的 structuredContent 形状在任何真实的
// @hulianui/mcp 上都不存在（源码 md 与产物字段混写、slots 被塞了 kind、整份文档缺 source）。
// 手写的东西没有任何机制会告诉你它脱档了，于是 adapter 从写完那天起就跑不通真实输出，而
// 全套测试仍然全绿 —— 因为测试喂的也是那份手写 fixture。
//
// 所以这里的规矩是：fixture 只能抓，不能写。contract 里能由服务端自证的引脚（产物路径 /
// sha256 / 版本、server 版本、npm integrity）一律从这次抓取里取，不许照抄上一版。
//
//   node scripts/capture-hulian-fixture.mjs --repository-commit <hulian 仓库 commit>
//   node scripts/capture-hulian-fixture.mjs --server /path/to/hulian/packages/mcp/src/index.mjs \
//        --repository-commit <sha> --server-version 0.11.0
//
// 默认走 `npx -y @hulianui/mcp@<版本>`，远程模式打线上文档站 —— 不需要 HulianUI 检出，
// 任何人都能复现同一份 fixture。

import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = new URL('../', import.meta.url);
const CONTRACT_URL = new URL('adapters/hulianui/contract.json', ROOT);
const FIXTURE_URL = new URL('adapters/hulianui/fixture.json', ROOT);

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const flags = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!key.startsWith('--')) die(`FLAG_INVALID:${key}`);
  const value = process.argv[index + 1];
  if (value === undefined) die(`FLAG_VALUE_MISSING:${key}`);
  flags.set(key.slice(2), value);
}

const contract = JSON.parse(readFileSync(fileURLToPath(CONTRACT_URL), 'utf8'));
// repository_commit 是**唯一**服务端自证不了的引脚（MCP 不知道自己的产物是哪个 commit 生成
// 的）。所以它必须每次显式给 —— 不给就报错，而不是默默沿用上一版那个已经脱档的值。
const repositoryCommit = flags.get('repository-commit');
if (!/^[0-9a-f]{40}$/.test(repositoryCommit ?? '')) {
  die('REPOSITORY_COMMIT_REQUIRED: --repository-commit <40 位 hulian 仓库 commit sha>');
}

const serverVersion = flags.get('server-version') ?? contract.server_version;
const serverEntry = flags.get('server');
const command = serverEntry
  ? {file: process.execPath, args: [serverEntry]}
  : {file: 'npx', args: ['-y', `${contract.server_package}@${serverVersion}`]};

/** 走 stdio 的 MCP 握手 + 一次 tools/call。刻意不引 SDK：本仓库不该为一次抓取长出运行时依赖。 */
function callServer(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {stdio: ['pipe', 'pipe', 'inherit']});
    const pending = new Map();
    let buffer = '';
    let nextId = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('SERVER_TIMEOUT'));
    }, 120_000);

    child.on('error', reject);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const settle = pending.get(message.id);
        if (settle) {
          pending.delete(message.id);
          settle(message);
        }
      }
    });

    const send = (method, params) =>
      new Promise((settle) => {
        const id = (nextId += 1);
        pending.set(id, settle);
        child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`);
      });

    (async () => {
      const handshake = await send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {name: 'ux-skill-capture', version: '1'},
      });
      child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`);
      const called = await send('tools/call', {name: contract.tool_name, arguments: request});
      clearTimeout(timer);
      child.kill();
      resolve({serverInfo: handshake.result?.serverInfo ?? null, result: called.result ?? null});
    })().catch((cause) => {
      clearTimeout(timer);
      child.kill();
      reject(cause);
    });
  });
}

/** npm 上那一版的 tarball integrity。没发布就是 null —— 编一个比留空危险得多。 */
async function npmIntegrity(name, version) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`);
    if (!res.ok) return null;
    return (await res.json())?.dist?.integrity ?? null;
  } catch {
    return null;
  }
}

const {serverInfo, result} = await callServer(contract.request);
if (!result) die('SERVER_NO_RESULT');
if (result.isError === true) {
  die(`SERVER_ERROR:${result.content?.[0]?.text ?? ''}`);
}
const document = result.structuredContent;
if (!document) die('SERVER_NO_STRUCTURED_CONTENT');

const reportedVersion = serverInfo?.version ?? null;
if (!serverEntry && reportedVersion !== serverVersion) {
  die(`SERVER_VERSION_MISMATCH: 期望 ${serverVersion}，实际 ${reportedVersion}`);
}

// contract.source_artifact 的三元组全部取自这次响应，不许手填：
//   · path    —— artifactDigests 的键，就是服务端自己用的产物名
//   · sha256  —— 服务端给的字节摘要（去掉 "sha256:" 前缀），可用 shasum -a 256 独立复核
//   · version —— 响应顶层的产物版本
const digests = document.source?.artifactDigests ?? null;
if (!digests) {
  die(
    'ARTIFACT_DIGESTS_UNAVAILABLE: 这个 server 不给 source.artifactDigests。' +
      '@hulianui/mcp >= 0.11.0 才有（hulianui/hulian#332）；旧版无法锚定证据。',
  );
}
const paths = Object.keys(digests);
if (paths.length !== 1) die(`ARTIFACT_DIGESTS_AMBIGUOUS:${paths.join(',')}`);
const [artifactPath] = paths;
const prefixed = digests[artifactPath];
if (!/^sha256:[0-9a-f]{64}$/.test(prefixed)) die(`ARTIFACT_DIGEST_MALFORMED:${prefixed}`);

const captured = {
  ...contract,
  npm_integrity: await npmIntegrity(contract.server_package, serverVersion),
  repository_commit: repositoryCommit,
  server_version: serverVersion,
  source_artifact: {
    path: artifactPath,
    sha256: prefixed.slice('sha256:'.length),
    version: document.version,
  },
};

// contract 以 JCS 规范字节落盘：它的 sha256 就是 adapter 里那个 CONTRACT_DIGEST，
// 「文件字节」与「规范字节」必须是同一样东西，否则两边永远对不上（既有测试在守这条）。
const {canonicalize} = await import('json-canonicalize');
const contractBytes = Buffer.from(canonicalize(captured), 'utf8');
writeFileSync(fileURLToPath(CONTRACT_URL), contractBytes);

const fixture = {
  transport_status: 'ok',
  isError: result.isError === true,
  content: result.content ?? [],
  structuredContent: document,
};
writeFileSync(fileURLToPath(FIXTURE_URL), `${JSON.stringify(fixture, null, 2)}\n`);

const {createHash} = await import('node:crypto');
const contractDigest = createHash('sha256').update(contractBytes).digest('hex');
const schemaPath = 'schemas/adapters/hulian-component-doc-v1.schema.json';
const schemaDigest = createHash('sha256')
  .update(readFileSync(fileURLToPath(new URL(schemaPath, ROOT))))
  .digest('hex');

process.stdout.write(
  [
    `captured=ok server=${command.file} ${command.args.join(' ')}`,
    `server_version=${serverVersion} npm_integrity=${captured.npm_integrity ?? 'null(未发布)'}`,
    `artifact=${artifactPath}@${document.version} sha256=${captured.source_artifact.sha256}`,
    `CONTRACT_DIGEST=${contractDigest}`,
    `SCHEMA_RAW_DIGEST=${schemaDigest}`,
    '把上面两个摘要抄进 adapters/hulianui/adapter.mjs，再跑 pnpm test。',
  ].join('\n') + '\n',
);
