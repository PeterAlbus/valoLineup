import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  buildContent,
  contentRevision,
  lineupsSchema,
  readContentDocument,
  stringifyLineups,
  validateContent,
  writeTextAtomic,
} from './content-model.mjs';

const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const uploadManifestSchema = z.array(z.object({
  field: z.string().regex(/^file-[a-f0-9-]+$/),
  lineupId: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(['stance', 'aim', 'effect']),
  alt: z.string().min(1),
}));

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function errorMessage(error) {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join('；');
  return error instanceof Error ? error.message : '保存失败';
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function asWebRequest(request) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request,
    duplex: 'half',
  });
}

async function saveDocument(root, formData) {
  const baseRevision = formData.get('baseRevision');
  const rawLineups = formData.get('lineups');
  const rawManifest = formData.get('uploads');
  if (typeof baseRevision !== 'string' || typeof rawLineups !== 'string' || typeof rawManifest !== 'string') {
    throw new Error('保存请求缺少点位数据或内容版本');
  }

  const yamlPath = path.join(root, 'content', 'lineups.yaml');
  const currentYaml = await readFile(yamlPath, 'utf8');
  if (contentRevision(currentYaml) !== baseRevision) {
    const conflict = new Error('本地元数据已经被其他操作修改，请重新进入编辑模式后再保存');
    conflict.statusCode = 409;
    throw conflict;
  }

  const current = await readContentDocument(root);
  const lineups = lineupsSchema.parse(JSON.parse(rawLineups));
  const uploads = uploadManifestSchema.parse(JSON.parse(rawManifest));
  const nextContent = await validateContent({ maps: current.maps, agents: current.agents, lineups }, { root, verifyAssets: true });
  const lineupById = new Map(nextContent.lineups.map((lineup) => [lineup.id, lineup]));
  const stageRoot = path.join(root, '.editor-tmp', randomUUID());
  const staged = [];
  const reservedPaths = [];
  const movedPaths = [];

  await mkdir(stageRoot, { recursive: true });
  try {
    for (const upload of uploads) {
      const file = formData.get(upload.field);
      const lineup = lineupById.get(upload.lineupId);
      if (!(file instanceof File) || !lineup) throw new Error('上传图片与点位数据无法对应');
      const extension = IMAGE_TYPES.get(file.type);
      if (!extension) throw new Error(`${file.name} 不是受支持的 PNG、JPG 或 WebP 图片`);
      if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} 必须小于 12 MB`);

      let ordinal = lineup.media[upload.kind].length + 1;
      let key;
      let finalPath;
      do {
        key = `lineups/${lineup.id}/${upload.kind}-${String(ordinal).padStart(2, '0')}.${extension}`;
        finalPath = path.join(root, 'public', key);
        ordinal += 1;
      } while (reservedPaths.includes(finalPath) || await fileExists(finalPath));

      const stagedPath = path.join(stageRoot, `${randomUUID()}.${extension}`);
      await writeFile(stagedPath, Buffer.from(await file.arrayBuffer()));
      staged.push({ stagedPath, finalPath });
      reservedPaths.push(finalPath);
      lineup.media[upload.kind].push({ key, alt: upload.alt });
    }

    await validateContent({ maps: current.maps, agents: current.agents, lineups: nextContent.lineups }, { root, verifyAssets: false });

    try {
      for (const item of staged) {
        await mkdir(path.dirname(item.finalPath), { recursive: true });
        await rename(item.stagedPath, item.finalPath);
        movedPaths.push(item.finalPath);
      }
      await writeTextAtomic(yamlPath, stringifyLineups(nextContent.lineups));
      await buildContent(root, { quiet: true });
    } catch (error) {
      await writeTextAtomic(yamlPath, currentYaml);
      await Promise.all(movedPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
      throw error;
    }

    const savedYaml = await readFile(yamlPath, 'utf8');
    return { lineups: nextContent.lineups, revision: contentRevision(savedYaml) };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export function localEditorPlugin() {
  return {
    name: 'valo-lineup-local-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (!pathname.startsWith('/api/editor/')) return next();

        try {
          if (request.method === 'GET' && pathname === '/api/editor/document') {
            const document = await readContentDocument(process.cwd());
            return sendJson(response, 200, document);
          }

          if (request.method === 'POST' && pathname === '/api/editor/save') {
            const contentLength = Number(request.headers['content-length'] ?? 0);
            if (contentLength > MAX_REQUEST_BYTES) return sendJson(response, 413, { error: '一次保存的总数据不能超过 50 MB' });
            const formData = await (await asWebRequest(request)).formData();
            const saved = await saveDocument(process.cwd(), formData);
            return sendJson(response, 200, saved);
          }

          return sendJson(response, 404, { error: '未知的本地编辑接口' });
        } catch (error) {
          const status = typeof error?.statusCode === 'number' ? error.statusCode : 400;
          return sendJson(response, status, { error: errorMessage(error) });
        }
      });
    },
  };
}
