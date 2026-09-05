import { useEffect, useRef, useState } from 'react';
import content from './data/content.json';
import { downloadEditPackage, type PackageUpload } from './edit-package';
import NewLineupDialog, { type NewLineupInput } from './NewLineupDialog';
import { openBilibiliVideo } from './toy-sdk';

type MediaItem = { key: string; alt: string };
type MediaKind = 'stance' | 'aim' | 'effect';
type Lineup = {
  id: string;
  mapId: string;
  agentId: string;
  abilityId: string;
  title: string;
  side: 'attack' | 'defense';
  area: string;
  videoBvid: string;
  target: { groupId: string; x: number; y: number };
  instructions: string;
  media: { stance: MediaItem[]; aim: MediaItem[]; effect: MediaItem[] };
};
type PendingUpload = {
  key: string;
  lineupId: string;
  kind: MediaKind;
  alt: string;
  file: File;
  previewUrl: string;
};
type EditorNotice = { kind: 'info' | 'success' | 'error'; text: string };
type LightboxItem = { src: string; alt: string };

const maps = content.maps;
const agents = content.agents;
const initialLineups = content.lineups as Lineup[];
const sideLabels = { attack: '进攻', defense: '防守' };
const mediaLabels = { stance: '站位', aim: '瞄点', effect: '道具效果' };
const sideFilterLabels = { attack: '进攻方道具', defense: '防守方道具', all: '全部道具' };
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.5;
const DESTINATION_CLUSTER_DISTANCE = 0.0125;
const MOBILE_VIEW_QUERY = '(max-width: 760px)';

type Point = { x: number; y: number };
type MapRegion = Point & { width: number; height: number; rotation: number };
type MapViewport = { zoom: number; x: number; y: number };
type Perspective = 'attack' | 'defense';
type SideFilter = Perspective | 'all';

function rotatePoint(point: Point, degrees: number) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - 0.5;
  const y = point.y - 0.5;
  return {
    x: 0.5 + x * cos - y * sin,
    y: 0.5 + x * sin + y * cos,
  };
}

function clusterDestinations(items: Lineup[], mergeNearby: boolean) {
  const exact = new Map<string, Lineup[]>();
  for (const lineup of items) exact.set(lineup.target.groupId, [...(exact.get(lineup.target.groupId) ?? []), lineup]);

  const destinations = [...exact.entries()].map(([id, lineups]) => ({
    id,
    lineups,
    x: lineups[0].target.x,
    y: lineups[0].target.y,
  }));

  if (!mergeNearby) {
    return destinations.map((destination) => ({
      id: destination.id,
      memberIds: [destination.id],
      items: destination.lineups,
      x: destination.x,
      y: destination.y,
    }));
  }

  const parents = destinations.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const unite = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < destinations.length; left += 1) {
    for (let right = left + 1; right < destinations.length; right += 1) {
      if (Math.hypot(destinations[left].x - destinations[right].x, destinations[left].y - destinations[right].y) <= DESTINATION_CLUSTER_DISTANCE) unite(left, right);
    }
  }

  const clusters = new Map<number, typeof destinations>();
  destinations.forEach((destination, index) => clusters.set(find(index), [...(clusters.get(find(index)) ?? []), destination]));
  return [...clusters.values()].map((cluster) => {
    const lineups = cluster.flatMap((destination) => destination.lineups);
    return {
      id: cluster[0].id,
      memberIds: cluster.map((destination) => destination.id),
      items: lineups,
      x: cluster.reduce((sum, destination) => sum + destination.x, 0) / cluster.length,
      y: cluster.reduce((sum, destination) => sum + destination.y, 0) / cluster.length,
    };
  });
}

function instructionSummary(lineup: Lineup) {
  return lineup.instructions.split('\n').find((line) => line.trim()) ?? '暂无操作说明';
}

function assetUrl(key: string) {
  return `${import.meta.env.BASE_URL}${key}`;
}

function imageExtension(file: File) {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

function nextMediaKey(lineup: Lineup, kind: MediaKind, file: File, reserved: Set<string>) {
  let sequence = 1;
  let key = '';
  do {
    key = `lineups/${lineup.id}/${kind}-${String(sequence).padStart(2, '0')}.${imageExtension(file)}`;
    sequence += 1;
  } while ([...reserved].some((candidate) => candidate.startsWith(key.slice(0, key.lastIndexOf('.') + 1))));
  reserved.add(key);
  return key;
}

function clampCoordinate(value: number) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(5));
}

function nextLineupId(mapId: string, agentId: string) {
  return `${mapId}-${agentId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export default function App() {
  const [savedLineups, setSavedLineups] = useState<Lineup[]>(initialLineups);
  const [draftLineups, setDraftLineups] = useState<Lineup[]>(initialLineups);
  const [selectedMapId, setSelectedMapId] = useState('ascent');
  const [selectedAgentId, setSelectedAgentId] = useState('sova');
  const [selectedGroupId, setSelectedGroupId] = useState('a-site-scan');
  const [selectedLineupId, setSelectedLineupId] = useState('ascent-sova-01');
  const [perspective, setPerspective] = useState<Perspective>('attack');
  const [sideFilter, setSideFilter] = useState<SideFilter>('attack');
  const [mapViewport, setMapViewport] = useState<MapViewport>({ zoom: MIN_ZOOM, x: 0, y: 0 });
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isEditorBusy, setIsEditorBusy] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [pasteTargetKind, setPasteTargetKind] = useState<MediaKind>('stance');
  const [lightboxItem, setLightboxItem] = useState<LightboxItem | null>(null);
  const [editorNotice, setEditorNotice] = useState<EditorNotice | null>(null);
  const [isNewLineupDialogOpen, setIsNewLineupDialogOpen] = useState(false);
  const [newLineupPlacement, setNewLineupPlacement] = useState<NewLineupInput | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pinDragRef = useRef<{ pointerId: number; groupIds: string[] } | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_VIEW_QUERY);
    const updateMobileView = () => setIsMobileView(mediaQuery.matches);
    updateMobileView();
    mediaQuery.addEventListener('change', updateMobileView);
    return () => mediaQuery.removeEventListener('change', updateMobileView);
  }, []);

  const isEditMode = isEditing && !isMobileView;
  const lineups = isEditMode ? draftLineups : savedLineups;
  const activeMap = maps.find((map) => map.id === selectedMapId) ?? maps[0];
  const mapLineups = lineups.filter((lineup) => lineup.mapId === selectedMapId);
  const filteredMapLineups = mapLineups.filter((lineup) => sideFilter === 'all' || lineup.side === sideFilter);
  const agentLineups = filteredMapLineups.filter((lineup) => lineup.agentId === selectedAgentId);
  const availableAgents = agents.filter((agent) => filteredMapLineups.some((lineup) => lineup.agentId === agent.id));
  const groups = clusterDestinations(agentLineups, !isEditMode);
  const activeGroup = groups.find((group) => group.memberIds.includes(selectedGroupId)) ?? groups[0];
  const activeLineup = activeGroup?.items.find((lineup) => lineup.id === selectedLineupId) ?? activeGroup?.items[0];
  const activeAgent = agents.find((agent) => agent.id === selectedAgentId) ?? availableAgents[0] ?? agents[0];
  const activeAbility = activeAgent?.abilities.find((ability) => ability.id === activeLineup?.abilityId);
  const perspectiveRotation = activeMap.perspectives[perspective].rotation;
  const pointForView = (point: Point) => rotatePoint(point, perspectiveRotation);
  const activeTargetPoint = activeLineup ? pointForView(activeLineup.target) : null;
  const activePendingUploads = activeLineup ? pendingUploads.filter((upload) => upload.lineupId === activeLineup.id) : [];

  function pointStyle(point: Point) {
    const viewPoint = pointForView(point);
    return {
      left: `calc(${50 + (viewPoint.x - 0.5) * 100 * mapViewport.zoom}% + ${mapViewport.x}px)`,
      top: `calc(${50 + (viewPoint.y - 0.5) * 100 * mapViewport.zoom}% + ${mapViewport.y}px)`,
    };
  }

  function regionStyle(region: MapRegion) {
    return {
      ...pointStyle(region),
      width: `${region.width * 100 * mapViewport.zoom}%`,
      height: `${region.height * 100 * mapViewport.zoom}%`,
      transform: `translate(-50%, -50%) rotate(${region.rotation + perspectiveRotation}deg)`,
    };
  }

  function constrainViewport(viewport: MapViewport) {
    const canvas = mapCanvasRef.current;
    if (!canvas || viewport.zoom === MIN_ZOOM) return { zoom: viewport.zoom, x: 0, y: 0 };
    const maxX = canvas.clientWidth * (viewport.zoom - 1) / 2;
    const maxY = canvas.clientHeight * (viewport.zoom - 1) / 2;
    return {
      zoom: viewport.zoom,
      x: Math.max(-maxX, Math.min(maxX, viewport.x)),
      y: Math.max(-maxY, Math.min(maxY, viewport.y)),
    };
  }

  function setZoom(nextZoom: number, clientX?: number, clientY?: number) {
    const canvas = mapCanvasRef.current;
    setMapViewport((current) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      if (!canvas || zoom === current.zoom) return current;
      const rect = canvas.getBoundingClientRect();
      const focusX = clientX === undefined ? 0 : clientX - (rect.left + rect.width / 2);
      const focusY = clientY === undefined ? 0 : clientY - (rect.top + rect.height / 2);
      const ratio = zoom / current.zoom;
      return constrainViewport({
        zoom,
        x: focusX - (focusX - current.x) * ratio,
        y: focusY - (focusY - current.y) * ratio,
      });
    });
  }

  function resetMapViewport() {
    setMapViewport({ zoom: MIN_ZOOM, x: 0, y: 0 });
  }

  function selectMap(mapId: string) {
    const nextLineups = lineups.filter((lineup) => lineup.mapId === mapId);
    const first = nextLineups.find((lineup) => sideFilter === 'all' || lineup.side === sideFilter);
    setSelectedMapId(mapId);
    resetMapViewport();
    if (first) {
      setSelectedAgentId(first.agentId);
      setSelectedGroupId(first.target.groupId);
      setSelectedLineupId(first.id);
    } else {
      setSelectedGroupId('');
      setSelectedLineupId('');
    }
  }

  function selectAgent(agentId: string) {
    const first = filteredMapLineups.find((lineup) => lineup.agentId === agentId);
    setSelectedAgentId(agentId);
    if (first) {
      setSelectedGroupId(first.target.groupId);
      setSelectedLineupId(first.id);
    }
  }

  function selectGroup(group: (typeof groups)[number]) {
    setSelectedGroupId(group.id);
    setSelectedLineupId(group.items[0].id);
  }

  function selectPerspective(nextPerspective: Perspective) {
    setPerspective(nextPerspective);
    setSideFilter(nextPerspective);
    const candidates = mapLineups.filter((lineup) => lineup.side === nextPerspective);
    const first = candidates.find((lineup) => lineup.id === selectedLineupId)
      ?? candidates.find((lineup) => lineup.agentId === selectedAgentId)
      ?? candidates[0];
    if (first) {
      setSelectedAgentId(first.agentId);
      setSelectedGroupId(first.target.groupId);
      setSelectedLineupId(first.id);
    } else {
      setSelectedGroupId('');
      setSelectedLineupId('');
    }
    resetMapViewport();
  }

  function selectSideFilter(nextFilter: SideFilter) {
    setSideFilter(nextFilter);
    const candidates = mapLineups.filter((lineup) => nextFilter === 'all' || lineup.side === nextFilter);
    const first = candidates.find((lineup) => lineup.id === selectedLineupId)
      ?? candidates.find((lineup) => lineup.agentId === selectedAgentId)
      ?? candidates[0];
    if (first) {
      setSelectedAgentId(first.agentId);
      setSelectedGroupId(first.target.groupId);
      setSelectedLineupId(first.id);
    } else {
      setSelectedGroupId('');
      setSelectedLineupId('');
    }
  }

  function handleMapWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom(mapViewport.zoom + direction, event.clientX, event.clientY);
  }

  function handleMapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (isEditMode && newLineupPlacement) {
      if ((event.target as HTMLElement).closest('button')) return;
      const point = rawPointFromPointer(event.clientX, event.clientY);
      if (point) createNewLineup(point);
      return;
    }
    if (mapViewport.zoom === MIN_ZOOM || (event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: mapViewport.x,
      originY: mapViewport.y,
    };
    setIsDraggingMap(true);
  }

  function handleMapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setMapViewport((current) => constrainViewport({
      zoom: current.zoom,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  }

  function finishMapDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDraggingMap(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function rawPointFromPointer(clientX: number, clientY: number) {
    const canvas = mapCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const viewPoint = {
      x: 0.5 + (clientX - rect.left - rect.width / 2 - mapViewport.x) / (rect.width * mapViewport.zoom),
      y: 0.5 + (clientY - rect.top - rect.height / 2 - mapViewport.y) / (rect.height * mapViewport.zoom),
    };
    const rawPoint = rotatePoint(viewPoint, -perspectiveRotation);
    return { x: clampCoordinate(rawPoint.x), y: clampCoordinate(rawPoint.y) };
  }

  function handlePinPointerDown(event: React.PointerEvent<HTMLButtonElement>, group: (typeof groups)[number]) {
    selectGroup(group);
    if (!isEditMode) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pinDragRef.current = { pointerId: event.pointerId, groupIds: group.memberIds };
  }

  function handlePinPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = pinDragRef.current;
    if (!isEditMode || !drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = rawPointFromPointer(event.clientX, event.clientY);
    if (!point) return;
    setDraftLineups((current) => current.map((lineup) => (
      lineup.mapId === selectedMapId && drag.groupIds.includes(lineup.target.groupId)
        ? { ...lineup, target: { ...lineup.target, ...point } }
        : lineup
    )));
    setIsDirty(true);
    setEditorNotice({ kind: 'info', text: `坐标 ${point.x.toFixed(5)}, ${point.y.toFixed(5)} · 尚未导出` });
  }

  function finishPinDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (pinDragRef.current?.pointerId !== event.pointerId) return;
    pinDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function clearPendingUploads() {
    pendingUploads.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    setPendingUploads([]);
  }

  function enterEditMode() {
    setDraftLineups(structuredClone(savedLineups));
    setIsDirty(false);
    setIsEditing(true);
    setIsNewLineupDialogOpen(false);
    setNewLineupPlacement(null);
    setEditorNotice({ kind: 'info', text: '修改会暂存在当前浏览器页面；完成后导出编辑包交给开发者' });
  }

  function exitEditMode() {
    if (isDirty && !window.confirm('尚有未导出的点位或图片，确定放弃吗？')) return;
    clearPendingUploads();
    setDraftLineups(savedLineups);
    setIsDirty(false);
    setIsEditing(false);
    setIsNewLineupDialogOpen(false);
    setNewLineupPlacement(null);
    setEditorNotice(null);
  }

  function beginNewLineupPlacement(input: NewLineupInput) {
    setIsNewLineupDialogOpen(false);
    setNewLineupPlacement(input);
    setSelectedMapId(input.mapId);
    setSelectedAgentId(input.agentId);
    setSelectedGroupId('');
    setSelectedLineupId('');
    setPerspective(input.side);
    setSideFilter(input.side);
    resetMapViewport();
    const mapName = maps.find((map) => map.id === input.mapId)?.name ?? input.mapId;
    setEditorNotice({ kind: 'info', text: `请在 ${mapName} 地图上点击技能最终落点，按当前${input.side === 'attack' ? '攻方' : '守方'}视角放置` });
  }

  function createNewLineup(point: Point) {
    if (!newLineupPlacement) return;
    const id = nextLineupId(newLineupPlacement.mapId, newLineupPlacement.agentId);
    const lineup: Lineup = {
      id,
      mapId: newLineupPlacement.mapId,
      agentId: newLineupPlacement.agentId,
      abilityId: newLineupPlacement.abilityId,
      title: newLineupPlacement.title,
      side: newLineupPlacement.side,
      area: newLineupPlacement.area,
      videoBvid: newLineupPlacement.videoBvid,
      target: { groupId: `${id}-target`, x: point.x, y: point.y },
      instructions: newLineupPlacement.instructions,
      media: { stance: [], aim: [], effect: [] },
    };
    setDraftLineups((current) => [...current, lineup]);
    setSelectedGroupId(lineup.target.groupId);
    setSelectedLineupId(lineup.id);
    setNewLineupPlacement(null);
    setIsDirty(true);
    setEditorNotice({ kind: 'info', text: `已创建“${lineup.title}”草稿，可以继续拖动或添加图片` });
  }

  function addImages(kind: MediaKind, files: FileList | File[] | null) {
    if (!activeLineup || !files?.length) return;
    const supported = Array.from(files).filter((file) => SUPPORTED_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_TYPES)[number]) && file.size <= MAX_IMAGE_BYTES);
    if (supported.length !== files.length) {
      setEditorNotice({ kind: 'error', text: '只支持小于 12 MB 的 PNG、JPG 或 WebP 图片' });
      return;
    }
    const reserved = new Set(draftLineups.flatMap((lineup) => Object.values(lineup.media).flat().map((item) => item.key)));
    const existingCount = activeLineup.media[kind].length;
    const uploads = supported.map((file, index) => {
      const alt = `${activeLineup.title}${mediaLabels[kind]}图 ${existingCount + index + 1}`;
      return {
        key: nextMediaKey(activeLineup, kind, file, reserved),
        lineupId: activeLineup.id,
        kind,
        alt,
        file,
        previewUrl: URL.createObjectURL(file),
      };
    });
    setDraftLineups((current) => current.map((lineup) => (
      lineup.id === activeLineup.id
        ? { ...lineup, media: { ...lineup.media, [kind]: [...lineup.media[kind], ...uploads.map(({ key, alt }) => ({ key, alt }))] } }
        : lineup
    )));
    setPendingUploads((current) => [...current, ...uploads]);
    setIsDirty(true);
    setEditorNotice({ kind: 'info', text: `已暂存 ${uploads.length} 张${mediaLabels[kind]}图 · 尚未导出` });
  }

  function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
    if (!isEditMode || !activeLineup) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    addImages(pasteTargetKind, images);
  }

  async function pasteImages(kind: MediaKind) {
    setPasteTargetKind(kind);
    if (!navigator.clipboard?.read) {
      setEditorNotice({ kind: 'error', text: `当前浏览器无法主动读取剪贴板，请先选择“${mediaLabels[kind]}图”区域后按 Ctrl+V` });
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const extension = imageType === 'image/png' ? 'png' : imageType === 'image/webp' ? 'webp' : 'jpg';
        files.push(new File([blob], `clipboard-${crypto.randomUUID()}.${extension}`, { type: imageType }));
      }
      if (!files.length) {
        setEditorNotice({ kind: 'error', text: '剪贴板中没有可用的图片' });
        return;
      }
      addImages(kind, files);
    } catch (error) {
      setEditorNotice({ kind: 'error', text: error instanceof Error ? `读取剪贴板失败：${error.message}` : '读取剪贴板失败，请改用 Ctrl+V' });
    }
  }

  function updateActiveVideoBvid(videoBvid: string) {
    if (!activeLineup) return;
    setDraftLineups((current) => current.map((lineup) => (
      lineup.id === activeLineup.id ? { ...lineup, videoBvid } : lineup
    )));
    setIsDirty(true);
    setEditorNotice({ kind: 'info', text: '教学视频 BV 号已修改 · 尚未导出' });
  }

  function updateActiveInstructions(instructions: string) {
    if (!activeLineup) return;
    setDraftLineups((current) => current.map((lineup) => (
      lineup.id === activeLineup.id ? { ...lineup, instructions } : lineup
    )));
    setIsDirty(true);
    setEditorNotice({ kind: 'info', text: '操作说明已修改 · 尚未导出' });
  }

  async function openTeachingVideo(videoBvid: string) {
    setEditorNotice(null);
    try {
      await openBilibiliVideo(videoBvid);
    } catch (error) {
      setEditorNotice({ kind: 'error', text: error instanceof Error ? error.message : '教学视频打开失败' });
    }
  }

  async function saveEdits() {
    if (!isDirty || isEditorBusy) return;
    const invalidVideo = draftLineups.find((lineup) => lineup.videoBvid && !/^BV[0-9A-Za-z]{10}$/.test(lineup.videoBvid));
    if (invalidVideo) {
      setEditorNotice({ kind: 'error', text: `“${invalidVideo.title}”的教学视频不是完整 BV 号` });
      return;
    }
    setIsEditorBusy(true);
    setEditorNotice({ kind: 'info', text: '正在生成编辑压缩包…' });
    try {
      const result = await downloadEditPackage({
        baseLineups: initialLineups,
        lineups: draftLineups,
        uploads: pendingUploads.map(({ previewUrl: _, ...upload }) => upload satisfies PackageUpload),
      });
      clearPendingUploads();
      setSavedLineups(initialLineups);
      setDraftLineups(initialLineups);
      setIsDirty(false);
      setIsEditing(false);
      setIsNewLineupDialogOpen(false);
      setNewLineupPlacement(null);
      if (!initialLineups.some((lineup) => lineup.id === selectedLineupId)) {
        const fallback = initialLineups.find((lineup) => lineup.mapId === selectedMapId) ?? initialLineups[0];
        setSelectedMapId(fallback.mapId);
        setSelectedAgentId(fallback.agentId);
        setSelectedGroupId(fallback.target.groupId);
        setSelectedLineupId(fallback.id);
      }
      setEditorNotice({ kind: 'success', text: `编辑包已下载：${result.added} 个新增点位、${result.updated} 个修改点位、${result.uploads} 张图片。请将 ZIP 交给开发者导入` });
    } catch (error) {
      setEditorNotice({ kind: 'error', text: error instanceof Error ? error.message : '编辑包生成失败' });
    } finally {
      setIsEditorBusy(false);
    }
  }

  function sectionItems(kind: MediaKind) {
    if (!activeLineup) return [];
    const pendingByKey = new Map(activePendingUploads.map((upload) => [upload.key, upload]));
    return activeLineup.media[kind].map((item) => ({
      id: item.key,
      src: pendingByKey.get(item.key)?.previewUrl ?? assetUrl(item.key),
      alt: item.alt,
      pending: pendingByKey.has(item.key),
    }));
  }

  return (
    <main
      className={`app-shell ${isEditMode ? 'is-editing' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && lightboxItem) setLightboxItem(null);
      }}
      onPaste={handlePaste}
    >
      <aside className="map-rail" aria-label="地图选择">
        <div className="brand-mark" aria-label="Lineup Atlas"><span>LA</span></div>
        <p className="eyebrow rail-label">地图</p>
        <div className="map-list">
          {maps.map((map) => {
            const count = lineups.filter((lineup) => lineup.mapId === map.id).length;
            return (
              <button
                aria-pressed={map.id === selectedMapId}
                className={`map-card ${map.id === selectedMapId ? 'is-active' : ''}`}
                key={map.id}
                onClick={() => selectMap(map.id)}
                type="button"
              >
                <span className="map-thumb"><img alt="" src={assetUrl(map.image)} /></span>
                <span className="map-name">{map.name}</span>
                <span className="map-count">{String(count).padStart(2, '0')}</span>
              </button>
            );
          })}
        </div>
        <div className="rail-footer">
          <span className="status-dot" />
          <p>非官方玩家项目<br />当前收录 {lineups.length} 条 Lineup</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">无畏契约 · LINEUP 图鉴</p>
            <h1>{activeMap.name}</h1>
          </div>
          <div className="topbar-tools">
            <div className="agent-tabs" aria-label="英雄选择">
              {availableAgents.map((agent) => {
                const count = filteredMapLineups.filter((lineup) => lineup.agentId === agent.id).length;
                return (
                  <button
                    aria-pressed={agent.id === selectedAgentId}
                    className={`agent-tab ${agent.id === selectedAgentId ? 'is-active' : ''}`}
                    key={agent.id}
                    onClick={() => selectAgent(agent.id)}
                    type="button"
                  >
                    <img alt={agent.name} src={assetUrl(agent.icon)} />
                    <span><b>{agent.name}</b><small>{count} 个点位</small></span>
                  </button>
                );
              })}
            </div>
            {!isMobileView ? (
              <div className="editor-actions" aria-label="浏览器编辑">
                {isEditMode ? (
                  <>
                    <button className="editor-new" disabled={isEditorBusy || Boolean(newLineupPlacement)} onClick={() => setIsNewLineupDialogOpen(true)} type="button">＋ 新增点位</button>
                    <button className="editor-cancel" disabled={isEditorBusy} onClick={exitEditMode} type="button">退出编辑</button>
                    <button className="editor-save" disabled={!isDirty || isEditorBusy} onClick={saveEdits} type="button">{isEditorBusy ? '生成中…' : '导出编辑包'}</button>
                  </>
                ) : (
                  <button className="editor-enter" onClick={enterEditMode} type="button">编辑点位</button>
                )}
              </div>
            ) : null}
          </div>
        </header>

        {editorNotice ? <div className={`editor-notice is-${editorNotice.kind}`} role="status">{editorNotice.text}</div> : null}

        <div className="content-grid">
          <section className="map-panel" aria-label={`${activeMap.name} Lineup 地图`}>
            <div className="panel-heading">
              <div><p className="eyebrow">{isEditMode ? '编辑技能最终落点' : '技能最终落点'}</p><h2>{groups.length ? (isEditMode ? '拖动标记调整坐标' : '选择地图上的标记') : '等待点位数据'}</h2></div>
              <div className="panel-tools">
                <div className="side-filter" aria-label="道具阵营筛选">
                  {(['attack', 'defense', 'all'] as const).map((filter) => (
                    <button
                      aria-pressed={sideFilter === filter}
                      className={sideFilter === filter ? 'is-active' : ''}
                      key={filter}
                      onClick={() => selectSideFilter(filter)}
                      type="button"
                    >{sideFilterLabels[filter]}</button>
                  ))}
                </div>
                <div className="legend"><span /> {activeMap.sites.map((site) => site.label).join('/')} 包点 · {activeAgent?.name ?? '未选择英雄'} · {groups.length} 个落点</div>
              </div>
            </div>

            <div
              className={`map-stage ${mapViewport.zoom > MIN_ZOOM ? 'is-zoomed' : ''} ${mapViewport.zoom >= 4 ? 'is-detail-zoom' : ''} ${isDraggingMap ? 'is-dragging' : ''} ${isEditMode && newLineupPlacement ? 'is-placing' : ''}`}
              onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) return;
                setZoom(mapViewport.zoom + ZOOM_STEP, event.clientX, event.clientY);
              }}
              onPointerCancel={finishMapDrag}
              onPointerDown={handleMapPointerDown}
              onPointerMove={handleMapPointerMove}
              onPointerUp={finishMapDrag}
              onWheel={handleMapWheel}
            >
              <div className="map-grid" />
              <div className="perspective-controls" aria-label="地图视角">
                {(['attack', 'defense'] as const).map((side) => (
                  <button
                    aria-pressed={perspective === side}
                    className={perspective === side ? 'is-active' : ''}
                    key={side}
                    onClick={() => selectPerspective(side)}
                    type="button"
                  >
                    {side === 'attack' ? '攻方视角' : '守方视角'}
                  </button>
                ))}
              </div>
              <div className="zoom-controls" aria-label="地图缩放">
                <button aria-label="缩小地图" disabled={mapViewport.zoom === MIN_ZOOM} onClick={() => setZoom(mapViewport.zoom - ZOOM_STEP)} type="button">−</button>
                <button className="zoom-value" aria-label="重置地图缩放" disabled={mapViewport.zoom === MIN_ZOOM} onClick={resetMapViewport} type="button">{Math.round(mapViewport.zoom * 100)}%</button>
                <button aria-label="放大地图" disabled={mapViewport.zoom === MAX_ZOOM} onClick={() => setZoom(mapViewport.zoom + ZOOM_STEP)} type="button">＋</button>
              </div>
              <div className="map-gesture-hint">{isEditMode ? '拖动 Lineup 标记修改落点 · 地图放大后可拖拽移动' : isMobileView ? '当前阵营位于地图下侧 · 使用 ＋ 放大 · 放大后拖动地图' : '当前阵营位于地图下侧 · 最高 800% · 放大后拖拽移动'}</div>
              {isEditMode && newLineupPlacement ? (
                <div className="placement-banner" role="status">
                  <span><b>放置新点位</b>点击地图上的技能最终落点</span>
                  <button
                    onClick={() => {
                      setNewLineupPlacement(null);
                      setEditorNotice({ kind: 'info', text: '已取消放置新点位' });
                    }}
                    type="button"
                  >取消</button>
                </div>
              ) : null}
              <div className="map-canvas" ref={mapCanvasRef}>
                <div
                  className="map-transform-layer"
                  style={{ transform: `translate3d(${mapViewport.x}px, ${mapViewport.y}px, 0) scale(${mapViewport.zoom}) rotate(${perspectiveRotation}deg)` }}
                >
                  <img className="map-image" alt={`${activeMap.name}俯视地图`} draggable="false" src={assetUrl(activeMap.imageHiRes)} />
                </div>
                {activeMap.sites.map((site) => (
                  <div aria-hidden="true" className="map-region map-site-region" key={`site-region-${site.label}`} style={regionStyle(site.region)} />
                ))}
                {(Object.entries(activeMap.spawns) as [Perspective, { labelPosition: Point }][]).map(([side, spawn]) => (
                  <div
                    aria-label={`${side === 'attack' ? '攻方' : '守方'}重生点`}
                    className={`map-spawn-text is-${side} ${perspective === side ? 'is-current' : ''}`}
                    key={`spawn-label-${side}`}
                    role="img"
                    style={pointStyle(spawn.labelPosition)}
                  >
                    <b>{side === 'attack' ? '攻方' : '守方'}</b><span>重生点</span>
                  </div>
                ))}
                {activeMap.sites.map((site) => (
                  <div
                    aria-label={`${site.label} 包点`}
                    className="map-region-label map-site-region-label"
                    key={`site-label-${site.label}`}
                    role="img"
                    style={pointStyle(site.region)}
                  >
                    <b>{site.label}</b><span>包点</span>
                  </div>
                ))}
                {groups.map((group, index) => {
                  const representative = group.items[0];
                  const ability = activeAgent?.abilities.find((item) => item.id === representative.abilityId);
                  return (
                    <button
                      aria-label={`${representative.area}，${representative.title}，${group.items.length} 种 Lineup${isEditMode ? '，可拖动' : ''}`}
                      aria-pressed={group.id === activeGroup?.id}
                      className={`lineup-pin ${group.id === activeGroup?.id ? 'is-active' : ''} ${isEditMode ? 'is-editable' : ''}`}
                      key={group.id}
                      onClick={() => selectGroup(group)}
                      onPointerCancel={finishPinDrag}
                      onPointerDown={(event) => handlePinPointerDown(event, group)}
                      onPointerMove={handlePinPointerMove}
                      onPointerUp={finishPinDrag}
                      style={pointStyle(group)}
                      type="button"
                    >
                      <span className="pin-pulse" />
                      <img alt="" src={assetUrl(ability?.icon ?? activeAgent.icon)} />
                      <i>{String(index + 1).padStart(2, '0')}</i>
                      {group.items.length > 1 ? <b>{group.items.length}</b> : null}
                      <span className="pin-label">{representative.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="detail-panel" aria-live="polite">
            {activeLineup && activeGroup ? (
              <>
                {activeGroup.items.length > 1 ? (
                  <section className="method-picker" aria-label="相近落点的 Lineup 方法">
                    <div className="method-heading"><p className="eyebrow">{isEditMode ? '同一落点' : '相近落点'}</p><span>{activeGroup.items.length} 种方法</span></div>
                    <div className="method-list">
                      {activeGroup.items.map((lineup, index) => (
                        <button
                          aria-pressed={lineup.id === activeLineup.id}
                          className={lineup.id === activeLineup.id ? 'is-active' : ''}
                          key={lineup.id}
                          onClick={() => setSelectedLineupId(lineup.id)}
                          type="button"
                        >
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <span><b>方法 {index + 1}</b><small>{instructionSummary(lineup)}</small></span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="detail-kicker">
                  <img alt="" src={assetUrl(activeAbility?.icon ?? activeAgent.icon)} />
                  <span>{activeAbility?.name} · {sideLabels[activeLineup.side]} · {activeLineup.area}</span>
                </div>
                <h2>{activeLineup.title}</h2>
                {isEditMode ? (
                  <label className="instructions-editor">
                    <span>操作说明 <small>可自由描述技能释放方式，每行一条</small></span>
                    <textarea
                      maxLength={1000}
                      onChange={(event) => updateActiveInstructions(event.target.value)}
                      placeholder="确认站位后瞄准墙面标记，然后按所需方式释放技能"
                      rows={4}
                      value={activeLineup.instructions}
                    />
                  </label>
                ) : (
                  <p className="detail-lead">{activeLineup.instructions || '按图确认站位和瞄点后释放技能。'}</p>
                )}
                {isEditMode ? <div className="coordinate-readout"><span>原始地图坐标</span><b>X {activeLineup.target.x.toFixed(5)}</b><b>Y {activeLineup.target.y.toFixed(5)}</b></div> : null}

                {isEditMode ? (
                  <label className="video-link-editor">
                    <span>B站教学视频 BV 号 <small>可留空</small></span>
                    <input
                      maxLength={12}
                      onChange={(event) => updateActiveVideoBvid(event.target.value.trim())}
                      pattern="BV[0-9A-Za-z]{10}"
                      placeholder="BV17x411w7KC"
                      value={activeLineup.videoBvid}
                    />
                  </label>
                ) : activeLineup.videoBvid ? (
                  <button className="video-link" onClick={() => void openTeachingVideo(activeLineup.videoBvid)} type="button">
                    <span><small>教学视频</small>观看完整操作演示</span><b aria-hidden="true">↗</b>
                  </button>
                ) : null}

                {(['stance', 'aim', 'effect'] as const).map((kind, sectionIndex) => {
                  const items = sectionItems(kind);
                  if (!items.length && !isEditMode) return null;
                  return (
                    <section className={`media-section ${isEditMode ? 'is-editable' : ''}`} key={kind}>
                      <p><span>0{sectionIndex + 1}</span>{mediaLabels[kind]}</p>
                      {items.map((item) => (
                        <div className={`media-item ${item.pending ? 'is-pending' : ''}`} key={item.id}>
                          <button
                            aria-label={`放大查看：${item.alt}`}
                            className="media-preview-button"
                            onClick={() => setLightboxItem({ src: item.src, alt: item.alt })}
                            type="button"
                          >
                            <img alt={item.alt} loading="lazy" src={item.src} />
                            <span aria-hidden="true">↗ 放大查看</span>
                          </button>
                          {item.pending ? <em>待导出</em> : null}
                        </div>
                      ))}
                      {isEditMode ? (
                        <div className={`media-add-actions ${pasteTargetKind === kind ? 'is-paste-target' : ''}`} onClick={() => setPasteTargetKind(kind)}>
                          <label className="media-add">
                            <span>＋ 添加{mediaLabels[kind]}图</span>
                            <small>PNG / JPG / WebP，单张不超过 12 MB</small>
                            <input
                              accept="image/png,image/jpeg,image/webp"
                              multiple
                              onChange={(event) => {
                                setPasteTargetKind(kind);
                                addImages(kind, event.target.files);
                                event.currentTarget.value = '';
                              }}
                              type="file"
                            />
                          </label>
                          <button className="media-paste" onClick={() => void pasteImages(kind)} type="button">粘贴图片</button>
                          <small className="paste-hint">{pasteTargetKind === kind ? '当前 Ctrl+V 粘贴目标' : '点击此区域后可按 Ctrl+V'}</small>
                        </div>
                      ) : null}
                    </section>
                  );
                })}

                {!sectionItems('effect').length ? (
                  <section className="effect-preview">
                    <p><span>03</span>效果落点</p>
                    <div>
                      <img alt="" className="effect-map" src={assetUrl(activeMap.imageHiRes)} style={{ transform: `rotate(${perspectiveRotation}deg)` }} />
                      {activeTargetPoint ? <i style={{ left: `${21.875 + activeTargetPoint.x * 56.25}%`, top: `${activeTargetPoint.y * 100}%` }} /> : null}
                      <strong>当前资料未包含游戏内效果截图</strong>
                    </div>
                  </section>
                ) : null}

                <p className="source-note">页面内容来自仓库静态元数据</p>
              </>
            ) : (
              <div className="empty-state"><span>00</span><h2>暂无已整理点位</h2><p>该地图已经进入资料库，但本地 YAML 还没有对应的完整 Lineup。</p></div>
            )}
          </aside>
        </div>
      </section>
      {isEditMode && isNewLineupDialogOpen ? (
        <NewLineupDialog
          agents={agents}
          initialAbilityId={activeLineup?.abilityId}
          initialAgentId={selectedAgentId}
          initialMapId={selectedMapId}
          maps={maps}
          onCancel={() => setIsNewLineupDialogOpen(false)}
          onPlace={beginNewLineupPlacement}
        />
      ) : null}
      {lightboxItem ? (
        <div
          className="lightbox-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setLightboxItem(null);
          }}
          role="presentation"
        >
          <section aria-label={`图片预览：${lightboxItem.alt}`} aria-modal="true" className="lightbox-dialog" role="dialog">
            <header><p>{lightboxItem.alt}</p><button autoFocus aria-label="关闭图片预览" onClick={() => setLightboxItem(null)} type="button">×</button></header>
            <img alt={lightboxItem.alt} src={lightboxItem.src} />
          </section>
        </div>
      ) : null}
    </main>
  );
}
