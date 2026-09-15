import { z } from 'zod';

export const TEXT_REVIEW_RULES_URL = 'https://file.peteralbus.com/assets/files/text-review-rules.json';
export const TEXT_REVIEW_TIMEOUT_MS = 5000;

const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[\p{Cf}\u034f\uFE00-\uFE0F]/gu, '');
const compact = text => text.replace(/[\s\p{P}\p{S}]/gu, '');
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function createTextReviewer(textReviewRules) {
  const rules = textReviewRules.map(rule => ({ ...rule, matchers: rule.terms.map(term => /\p{Script=Han}/u.test(term)
    ? { word: compact(normalize(term)) }
    : { pattern: new RegExp(`(?:^|[^a-z0-9])${normalize(term).split(/\s+/).map(escapePattern).join('[\\s._-]*')}(?:$|[^a-z0-9])`, 'u') }) }));

  function containsLink(text) {
    const value = text.replace(/\s+/gu, '').replace(/[。｡]/g, '.');
    return /<a(?:\s|>)/iu.test(text) || /(?:^|[\s(])\/\/[a-z0-9[]/iu.test(text)
      || /(?:[a-z][a-z\d+.-]*:\/\/|(?:https?|hxxps?|mailto|tel|javascript|data):|www\.|localhost[:/]|\[[^\]]*\]\([^)]+\))/iu.test(value)
      || /(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62})\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]+|中国|中國|公司|网络|網絡|网址|網址)(?![a-z])/iu.test(value)
      || /(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?=$|[^\d.])/u.test(value);
  }

  function reviewText(text) {
    const value = normalize(text), joined = compact(value);
    const found = [];
    if (containsLink(value)) found.push('链接');
    for (const rule of rules) if (rule.matchers.some(matcher => matcher.word ? joined.includes(matcher.word) : matcher.pattern.test(value))) found.push(rule.label);
    return found;
  }

  // Only schema-defined machine fields are excluded; extension text is reviewed too.
  const recordPath = 'changes\\.(?:added\\.\\d+|updated\\.\\d+\\.(?:before|after)|deleted\\.\\d+\\.before)';
  const machineRecordField = new RegExp(`^${recordPath}\\.(?:id|mapId|agentId|abilityId|side|videoBvid|target\\.groupId|uploader\\.(?:source|toyOpenId|bilibiliUid)|media\\.(?:stance|aim|effect)\\.\\d+\\.(?:key|original\\.(?:key|sha256)))$`);
  function isMachineField(path) {
    return /^(?:format|packageId|createdAt|updatedAt|author\.(?:source|toyOpenId|bilibiliUid))$/.test(path)
      || /^changes\.(?:updated|deleted)\.\d+\.id$/.test(path)
      || /^(?:uploadedAssets|referencedAssets)\.\d+\.(?:key|lineupId|kind|mimeType|sha256|original\.(?:key|sha256))$/.test(path)
      || machineRecordField.test(path);
  }

  const labels = { author: '更新包作者', name: '姓名', title: '点位名称', area: '区域', instructions: '操作说明', uploader: '上传者', media: '图片', stance: '站位图', aim: '瞄点图', effect: '效果图', alt: '图片说明', uploadedAssets: '随包图片', referencedAssets: '引用图片', before: '修改前', after: '修改后' };
  function fieldLabel(path) {
    return path.replace(/^changes\.added\.(\d+)/, (_, i) => `新增点位第 ${Number(i) + 1} 条`)
      .replace(/^changes\.updated\.(\d+)/, (_, i) => `修改点位第 ${Number(i) + 1} 条`)
      .replace(/^changes\.deleted\.(\d+)/, (_, i) => `删除点位第 ${Number(i) + 1} 条`)
      .split('.').map(part => Object.hasOwn(labels, part) ? labels[part] : /^\d+$/.test(part) ? `第 ${Number(part) + 1} 项` : reviewText(part).length ? '扩展字段' : part).join(' / ');
  }

  function collectTextFindings(manifest, includeSnapshots) {
    const findings = [];
    const visit = (value, path = '') => {
      // Saving checks current content, so corrections and deletions of old text remain possible.
      if (!includeSnapshots && /^(?:changes\.updated\.\d+\.before|changes\.deleted)$/.test(path)) return;
      if (typeof value === 'string' && !isMachineField(path)) {
        const categories = reviewText(value);
        if (categories.length) findings.push({ path, field: fieldLabel(path), categories });
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key.replaceAll('.', '%2E')}` : key.replaceAll('.', '%2E'));
      }
    };
    visit(manifest);
    return findings;
  }

  function reviewPackageText(manifest) {
    return collectTextFindings(manifest, true);
  }

  function assertPackageTextAllowed(manifest, operation) {
    const findings = collectTextFindings(manifest, operation !== '保存');
    if (!findings.length) return;
    const details = findings.slice(0, 3).map(item => `${item.field}：${item.categories.join('、')}`).join('；');
    const error = new Error(`${operation}已中止，文本检查未通过。${details}${findings.length > 3 ? `；另有 ${findings.length - 3} 处` : ''}。请修改后重试。`);
    error.name = 'PackageTextReviewError';
    error.findings = findings;
    throw error;
  }

  return { reviewText, reviewPackageText, assertPackageTextAllowed };
}

const wordListSchema = z.object({
  version: z.number().int().positive(),
  rules: z.array(z.object({
    category: z.enum(['sexual', 'politics']),
    label: z.string().trim().min(1).max(40),
    terms: z.array(z.string().trim().min(1).refine(term => compact(normalize(term)).length > 0)),
  })),
});

export async function assertPackageTextAllowed(manifest, operation) {
  let reviewer;
  let textReviewWarning = '';
  try {
    const response = await fetch(TEXT_REVIEW_RULES_URL, {
      cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(TEXT_REVIEW_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('Word list request failed');
    const data = wordListSchema.parse(await response.json());
    reviewer = createTextReviewer(data.rules);
  } catch {
    reviewer = createTextReviewer([]);
    textReviewWarning = '词库加载失败，本次未进行敏感词检查。';
  }
  reviewer.assertPackageTextAllowed(manifest, operation);
  return { textReviewWarning };
}
