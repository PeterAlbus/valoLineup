import { ZodError } from 'zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import content from './data/content.json';
import { buildManualPackage, downloadEditPackage } from './edit-package';
import { allMedia, same, collectChanges, compressPackage, applyLayers, readPackage, validateReferences, packageStats, MAX_PACKAGE_BYTES, type Lineup, type MediaKind, type Manifest, type Uploader, type PackageData } from './package-model.mjs';
import { encodeWebp, formatBytes } from './image-compression';
import { emptyLibrary, readLibrary, readImage, libraryUrls, persistLibrary, migrateLegacyImages, STORAGE_KEY, type LocalLibrary } from './local-library';
import HistoryPage, { UploaderLabel } from './HistoryPage';
import AgentPicker from './AgentPicker';
import { getToyUploader, openBilibiliProfile, openBilibiliVideo } from './toy-sdk';
import { usePanZoom } from './usePanZoom';
import { useDecodedImage } from './useDecodedImage';
import ZoomControls from './ZoomControls';
import ImageLightbox from './ImageLightbox';
import ExitEditDialog from './ExitEditDialog';
import ConfirmDialog from './ConfirmDialog';
import PackageImport from './PackageImport';

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
type DeleteRequest = { kind: 'manual' } | { kind: 'package'; id: string; author: string } | { kind: 'lineup'; id: string; title: string };

const maps = content.maps;
const agents = content.agents;
const initialLineups = content.lineups as Lineup[];
const sideLabels = { attack: '进攻', defense: '防守' };
const mediaLabels = { stance: '站位', aim: '瞄点', effect: '道具效果' };
const sideFilterLabels = { attack: '进攻方道具', defense: '防守方道具', all: '全部道具' };
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MIN_ZOOM = 1;
const DESTINATION_CLUSTER_DISTANCE = 0.0125;
const MOBILE_VIEW_QUERY = '(max-width: 760px)';

type Point = { x: number; y: number };
type MapRegion = Point & { width: number; height: number; rotation: number };
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
  for (const lineup of items) {
    // Browser overlays may intentionally move only one member of a formerly shared destination.
    const key = `${lineup.target.groupId}@${lineup.target.x},${lineup.target.y}`;
    exact.set(key, [...(exact.get(key) ?? []), lineup]);
  }

  const destinations = [...exact.values()].map((lineups) => ({
    // A position changes while dragging; use a member's stable ID for React keys and pointer capture.
    id: lineups[0].id,
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

function nextMediaKey(lineup: Lineup, kind: MediaKind, file: File) {
  return `lineups/${lineup.id}/${kind}-${crypto.randomUUID()}.${imageExtension(file)}`;
}

function editorError(error: unknown, message: string) {
  if (error instanceof ZodError) return '资料内容不完整或格式不正确，请检查点位资料或重新获取完整的编辑包。';
  if (error instanceof Error && !(error instanceof DOMException) && /[\u4e00-\u9fff]/.test(error.message)) return error.message;
  return message;
}

function clampCoordinate(value: number) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(5));
}

function nextLineupId(mapId: string, agentId: string) {
  return `${mapId}-${agentId}-${crypto.randomUUID()}`;
}

export default function App() {
  const [library, setLibrary] = useState<LocalLibrary>(emptyLibrary);
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [storageReady, setStorageReady] = useState(false);
  const [showHistory, setShowHistory] = useState(location.hash === '#history');
  const [uploader, setUploader] = useState<Uploader | null>(null);
  const manualIdRef = useRef<string>(crypto.randomUUID());
  const { lineups: savedLineups, sources } = useMemo(() => applyLayers(initialLineups, library.packages, library.manual), [library]);
  const [draftLineups, setDraftLineups] = useState<Lineup[]>(initialLineups);
  const [selectedMapId, setSelectedMapId] = useState('ascent');
  const [selectedAgentId, setSelectedAgentId] = useState('sova');
  const [selectedGroupId, setSelectedGroupId] = useState('a-site-scan');
  const [selectedLineupId, setSelectedLineupId] = useState('ascent-sova-01');
  const [perspective, setPerspective] = useState<Perspective>('attack');
  const [sideFilter, setSideFilter] = useState<SideFilter>('attack');
  const [isEditing, setIsEditing] = useState(false);
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isEditorBusy, setIsEditorBusy] = useState(false);
  const isDirty = isEditing && !same(draftLineups, savedLineups);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const compressionRef = useRef(false);
  const [pasteTargetKind, setPasteTargetKind] = useState<MediaKind>('stance');
  const [lightboxItem, setLightboxItem] = useState<LightboxItem | null>(null);
  const [editorNotice, setEditorNotice] = useState<EditorNotice | null>(null);
  const [newLineupId, setNewLineupId] = useState<string | null>(null);
  const newLineupOriginRef = useRef({ lineupId: '', sideFilter: 'attack' as SideFilter });
  const [newLineupPlacement, setNewLineupPlacement] = useState<{ agentId: string; abilityId: string; side: Perspective } | null>(null);
  const [validation, setValidation] = useState<{ id: string; field: 'title' | 'area' | 'videoBvid'; message: string } | null>(null);
  const detailPanelRef = useRef<HTMLElement>(null);
  const mapCanvasRef = useRef<HTMLDivElement>(null);
  const mapStageRef = useRef<HTMLDivElement>(null);
  // Pointer coordinates retain subpixel precision that click events may round away.
  const mapClickPointRef = useRef<Point | null>(null);
  const { viewport: mapViewport, isDragging: isDraggingMap, setZoom, reset: resetMapViewport, handlers: mapHandlers } = usePanZoom(mapStageRef, mapCanvasRef);
  const pinDragRef = useRef<{ pointerId: number; lineupIds: string[] } | null>(null);

  useEffect(() => {
    let active = true;
    let urls = new Map<string, string>();
    void (async () => {
      let metadataLoaded = false;
      try {
        let value = readLibrary();
        for (const manifest of [...value.packages, ...(value.manual ? [value.manual] : [])]) validateReferences(manifest, maps, agents);
        metadataLoaded = true;
        if (active) setLibrary(value);
        value = await migrateLegacyImages(value);
        if (active) setLibrary(value);
        urls = await libraryUrls(value);
        if (active) setImageUrls(urls); else urls.forEach((url) => URL.revokeObjectURL(url));
      } catch (error) { if (active) setEditorNotice({ kind: 'error', text: editorError(error, '本地数据读取失败，未覆盖原数据') }); }
      finally { if (active && metadataLoaded) setStorageReady(true); }
    })();
    const hashChange = () => setShowHistory(location.hash === '#history');
    const storageChange = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) setEditorNotice({ kind: 'error', text: '其他标签页修改了本地数据；请先导出当前草稿，再刷新页面同步。' }); };
    window.addEventListener('hashchange', hashChange); window.addEventListener('storage', storageChange);
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); window.removeEventListener('hashchange', hashChange); window.removeEventListener('storage', storageChange); };
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isDirty || isEditorBusy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty, isEditorBusy]);

  useEffect(() => () => imageUrls.forEach((url) => URL.revokeObjectURL(url)), [imageUrls]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_VIEW_QUERY);
    const updateMobileView = () => setIsMobileView(mediaQuery.matches);
    updateMobileView();
    mediaQuery.addEventListener('change', updateMobileView);
    return () => mediaQuery.removeEventListener('change', updateMobileView);
  }, []);

  const isEditMode = isEditing;
  const lineups = isEditMode ? draftLineups : savedLineups;
  const activeMap = maps.find((map) => map.id === selectedMapId) ?? maps[0];
  const mapImage = useDecodedImage(assetUrl(activeMap.imageHiRes));
  const mapLineups = lineups.filter((lineup) => lineup.mapId === selectedMapId);
  const filteredMapLineups = mapLineups.filter((lineup) => (lineup.id === newLineupId || sideFilter === 'all' || lineup.side === sideFilter) && !(newLineupPlacement && lineup.id === newLineupId));
  const agentLineups = filteredMapLineups.filter((lineup) => lineup.agentId === selectedAgentId);
  const availableAgents = agents.filter((agent) => filteredMapLineups.some((lineup) => lineup.agentId === agent.id));
  const groups = clusterDestinations(agentLineups, !isEditMode);
  const activeGroup = groups.find((group) => group.items.some((lineup) => lineup.id === selectedLineupId)) ?? groups.find((group) => group.memberIds.includes(selectedGroupId)) ?? groups[0];
  const activeLineup = newLineupPlacement ? undefined : activeGroup?.items.find((lineup) => lineup.id === selectedLineupId) ?? activeGroup?.items[0];
  const activeAgent = agents.find((agent) => agent.id === selectedAgentId) ?? availableAgents[0] ?? agents[0];
  const activeAbility = activeAgent?.abilities.find((ability) => ability.id === activeLineup?.abilityId);
  const perspectiveRotation = activeMap.perspectives[perspective].rotation;
  const pointForView = (point: Point) => rotatePoint(point, perspectiveRotation);
  const activeTargetPoint = activeLineup ? pointForView(activeLineup.target) : null;
  const activePendingUploads = activeLineup ? pendingUploads.filter((upload) => upload.lineupId === activeLineup.id) : [];
  const editChanges = useMemo(() => collectChanges(library.manual, savedLineups, isEditing ? draftLineups : savedLineups), [library.manual, savedLineups, draftLineups, isEditing]);
  const packageImageBytes = allMedia([...editChanges.added, ...editChanges.updated.map((item) => item.after)]).reduce((sum, item) => {
    const pending = pendingUploads.find((upload) => upload.key === item.key);
    const local = sources.get(item.lineupId)?.uploadedAssets.find((asset) => asset.key === item.key);
    return sum + (pending?.file.size ?? local?.size ?? (content.mediaBytes as Record<string, number>)[item.key] ?? 0);
  }, 0);
  const isPackageFull = packageImageBytes > MAX_PACKAGE_BYTES;

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

  function selectMap(mapId: string) {
    if (showHistory) location.hash = '';
    if (mapId === selectedMapId) return;
    const nextLineups = lineups.filter((lineup) => lineup.mapId === mapId);
    const first = nextLineups.find((lineup) => sideFilter === 'all' || lineup.side === sideFilter);
    setSelectedMapId(mapId);
    resetMapViewport();
    if (newLineupPlacement || newLineupId) {
      if (newLineupId) {
        const draft = draftLineups.find((item) => item.id === newLineupId)!;
        setDraftLineups((current) => current.map((item) => item.id === newLineupId ? { ...item, mapId } : item));
        setNewLineupPlacement({ agentId: draft.agentId, abilityId: draft.abilityId, side: draft.side });
      }
      return;
    }
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
    if (newLineupPlacement || newLineupId) return;
    const first = filteredMapLineups.find((lineup) => lineup.agentId === agentId);
    setSelectedAgentId(agentId);
    if (first) {
      setSelectedGroupId(first.target.groupId);
      setSelectedLineupId(first.id);
    }
  }

  function selectGroup(group: (typeof groups)[number]) {
    if (newLineupPlacement || (newLineupId && !group.items.some((item) => item.id === newLineupId))) return;
    setSelectedGroupId(group.id);
    setSelectedLineupId(group.items[0].id);
  }

  function selectPerspective(nextPerspective: Perspective) {
    if (nextPerspective === perspective) return;
    setPerspective(nextPerspective);
    if (!newLineupPlacement && !newLineupId) setSideFilter(nextPerspective);
    if (newLineupPlacement || newLineupId) { resetMapViewport(); return; }
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
    if (newLineupPlacement || newLineupId) return;
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

  function handleMapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    mapClickPointRef.current = null;
    if (mapImage.status !== 'ready') return;
    mapHandlers.onPointerDown(event);
  }

  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!isEditMode || !newLineupPlacement || mapImage.status !== 'ready') return;
    if ((event.target as HTMLElement).closest('button, input, [data-zoom-controls]')) return;
    const point = mapClickPointRef.current;
    if (point) createNewLineup(point);
  }

  function rawPointFromPointer(clientX: number, clientY: number) {
    const canvas = mapCanvasRef.current;
    const stage = mapStageRef.current;
    if (!canvas || !stage) return null;
    const stageRect = stage.getBoundingClientRect();
    if (clientX < stageRect.left || clientX > stageRect.right || clientY < stageRect.top || clientY > stageRect.bottom) return null;
    const rect = canvas.getBoundingClientRect();
    const viewPoint = {
      x: 0.5 + (clientX - rect.left - rect.width / 2 - mapViewport.x) / (rect.width * mapViewport.zoom),
      y: 0.5 + (clientY - rect.top - rect.height / 2 - mapViewport.y) / (rect.height * mapViewport.zoom),
    };
    const rawPoint = rotatePoint(viewPoint, -perspectiveRotation);
    if (rawPoint.x < 0 || rawPoint.x > 1 || rawPoint.y < 0 || rawPoint.y > 1) return null;
    return { x: clampCoordinate(rawPoint.x), y: clampCoordinate(rawPoint.y) };
  }

  function handlePinPointerDown(event: React.PointerEvent<HTMLButtonElement>, group: (typeof groups)[number]) {
    if (!isEditMode || isEditorBusy || newLineupPlacement || (newLineupId && !group.items.some((item) => item.id === newLineupId)) || event.button !== 0) return;
    window.getSelection()?.removeAllRanges();
    selectGroup(group);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pinDragRef.current = { pointerId: event.pointerId, lineupIds: group.items.map((lineup) => lineup.id) };
  }

  function handlePinPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = pinDragRef.current;
    if (!isEditMode || !drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = rawPointFromPointer(event.clientX, event.clientY);
    if (!point) return;
    setDraftLineups((current) => current.map((lineup) => (
      lineup.mapId === selectedMapId && drag.lineupIds.includes(lineup.id)
        ? { ...lineup, target: { ...lineup.target, ...point } }
        : lineup
    )));
    setEditorNotice(null);
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

  async function enterEditMode() {
    if (!storageReady || isEditorBusy) return;
    setIsEditorBusy(true);
    try {
      const identity = await getToyUploader();
      setUploader(identity);
      manualIdRef.current = library.manual?.packageId ?? crypto.randomUUID();
      setDraftLineups(structuredClone(savedLineups));
      setIsEditing(true);
      setNewLineupId(null);
      setNewLineupPlacement(null);
      if (showHistory) location.hash = '';
      setEditorNotice({ kind: 'info', text: `编辑人：${identity.name}。修改后请保存，也可以下载编辑包分享。` });
    } catch (error) { setEditorNotice({ kind: 'error', text: editorError(error, 'B站身份授权失败') }); }
    finally { setIsEditorBusy(false); }
  }

  function exitEditMode() {
    if (isEditorBusy) return;
    setIsExitConfirmOpen(false);
    clearPendingUploads();
    setDraftLineups(savedLineups);
    setIsEditing(false);
    setNewLineupId(null);
    setNewLineupPlacement(null);
    setLightboxItem(null);
    setEditorNotice({ kind: 'info', text: '已退出编辑。此前已保存的本地编辑仍然保留。' });
  }

  function beginNewLineupPlacement() {
    newLineupOriginRef.current = { lineupId: selectedLineupId, sideFilter };
    setNewLineupPlacement({ agentId: activeAgent.id, abilityId: activeAbility?.id ?? activeAgent.abilities[0].id, side: sideFilter === 'all' ? perspective : sideFilter });
    setValidation(null);
    setPasteTargetKind('stance');
    setEditorNotice(null);
  }

  function cancelNewLineup() {
    if (isEditorBusy) return;
    const candidates = draftLineups.filter((item) => item.id !== newLineupId && item.mapId === selectedMapId);
    const selected = candidates.find((item) => item.id === newLineupOriginRef.current.lineupId)
      ?? candidates.find((item) => item.side === sideFilter) ?? candidates[0];
    if (selected) {
      setSelectedAgentId(selected.agentId);
      setSelectedLineupId(selected.id);
      setSelectedGroupId(selected.target.groupId);
      setSideFilter(newLineupOriginRef.current.sideFilter === 'all' ? 'all' : selected.side);
    }
    if (newLineupId) {
      setDraftLineups((current) => current.filter((item) => item.id !== newLineupId));
      pendingUploads.filter((item) => item.lineupId === newLineupId).forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPendingUploads((current) => current.filter((item) => item.lineupId !== newLineupId));
    }
    setNewLineupId(null);
    setNewLineupPlacement(null);
    setValidation(null);
    setEditorNotice(null);
  }

  function createNewLineup(point: Point) {
    if (!newLineupPlacement || !uploader) return;
    const id = newLineupId ?? nextLineupId(selectedMapId, newLineupPlacement.agentId);
    if (newLineupId) {
      setDraftLineups((current) => current.map((item) => item.id === id ? { ...item, target: { ...item.target, ...point } } : item));
    } else {
      const lineup: Lineup = {
        id, uploader, mapId: selectedMapId, ...newLineupPlacement,
        title: '', area: '', videoBvid: '', instructions: '',
        target: { groupId: `${id}-target`, ...point },
        media: { stance: [], aim: [], effect: [] },
      };
      setDraftLineups((current) => [...current, lineup]);
    }
    setNewLineupId(id);
    setSelectedAgentId(newLineupPlacement.agentId);
    setSelectedGroupId(id);
    setSelectedLineupId(id);
    setNewLineupPlacement(null);
    setEditorNotice(null);
    requestAnimationFrame(() => {
      if (detailPanelRef.current) detailPanelRef.current.scrollTop = 0;
      detailPanelRef.current?.querySelector<HTMLInputElement>('[aria-label="点位名称"]')?.focus({ preventScroll: true });
    });
  }

  async function addImages(kind: MediaKind, files: FileList | File[] | null) {
    if (!activeLineup || !files?.length || isEditorBusy || compressionRef.current) return;
    const supported = Array.from(files).filter((file) => SUPPORTED_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_TYPES)[number]) && file.size <= MAX_IMAGE_BYTES);
    if (supported.length !== files.length) {
      setEditorNotice({ kind: 'error', text: '只支持小于 12 MB 的 PNG、JPG 或 WebP 图片' });
      return;
    }
    compressionRef.current = true;
    setIsEditorBusy(true);
    setEditorNotice({ kind: 'info', text: '正在处理图片，请稍候…' });
    try {
    const existingCount = activeLineup.media[kind].length;
    const uploads: PendingUpload[] = [];
    for (const [index, original] of supported.entries()) {
      const blob = await encodeWebp(original);
      const file = new File([blob], `upload-${crypto.randomUUID()}.webp`, { type: 'image/webp' });
      const alt = `${activeLineup.title}${mediaLabels[kind]}图 ${existingCount + index + 1}`;
      uploads.push({
        key: nextMediaKey(activeLineup, kind, file),
        lineupId: activeLineup.id,
        kind,
        alt,
        file,
        previewUrl: '',
      });
    }
    const existingKeys = new Set(allMedia([...editChanges.added, ...editChanges.updated.map((item) => item.after)]).map((item) => item.key));
    const newlyIncluded = allMedia([activeLineup]).filter((item) => !existingKeys.has(item.key)).reduce((sum, item) => sum + (sources.get(item.lineupId)?.uploadedAssets.find((asset) => asset.key === item.key)?.size ?? (content.mediaBytes as Record<string, number>)[item.key] ?? 0), 0);
    if (packageImageBytes + newlyIncluded + uploads.reduce((sum, upload) => sum + upload.file.size, 0) > MAX_PACKAGE_BYTES) throw new Error('图片总量将超过 128 MB，请删除不需要的图片或点位后再上传');
    uploads.forEach((upload) => { upload.previewUrl = URL.createObjectURL(upload.file); });
    setDraftLineups((current) => current.map((lineup) => (
      lineup.id === activeLineup.id
        ? { ...lineup, media: { ...lineup.media, [kind]: [...lineup.media[kind], ...uploads.map(({ key, alt }) => ({ key, alt }))] } }
        : lineup
    )));
    setPendingUploads((current) => [...current, ...uploads]);
    setEditorNotice({ kind: 'info', text: `已添加 ${uploads.length} 张图片（${formatBytes(uploads.reduce((sum, item) => sum + item.file.size, 0))}）· 尚未保存` });
    } catch (error) { setEditorNotice({ kind: 'error', text: editorError(error, '图片添加失败，请重试') }); }
    finally { compressionRef.current = false; setIsEditorBusy(false); }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
    if (!isEditMode || !activeLineup) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    void addImages(pasteTargetKind, images);
  }

  function updateActiveFields(fields: Partial<Pick<Lineup, 'title' | 'side' | 'area' | 'agentId' | 'abilityId'>>) {
    if (!activeLineup) return;
    setDraftLineups((current) => current.map((item) => item.id === activeLineup.id ? { ...item, ...fields } : item));
    setValidation(null);
    setEditorNotice(null);
    if (fields.agentId) setSelectedAgentId(fields.agentId);
    if (fields.side && sideFilter !== 'all') setSideFilter('all');
  }

  function confirmDeletion() {
    if (!deleteRequest || isEditorBusy) return;
    setDeleteRequest(null);
    if (deleteRequest.kind === 'manual') {
      void manageLibrary({ ...library, manual: null }, undefined, '已删除本地手动编辑。内置点位与已导入的更新包仍然保留。');
      return;
    }
    if (deleteRequest.kind === 'package') {
      void manageLibrary({ ...library, packages: library.packages.filter((item) => item.packageId !== deleteRequest.id) }, undefined, '已移除更新包，并根据剩余更新包显示资料。已保存的手动编辑不受影响。');
      return;
    }
    if (!isEditing) return;
    setDraftLineups((current) => current.filter((item) => item.id !== deleteRequest.id));
    const removed = pendingUploads.filter((upload) => upload.lineupId === deleteRequest.id);
    removed.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    setPendingUploads((current) => current.filter((upload) => upload.lineupId !== deleteRequest.id));
    setEditorNotice({ kind: 'info', text: '已标记删除点位，保存后生效。' });
  }

  function removeImage(kind: MediaKind, key: string) {
    if (!activeLineup) return;
    setDraftLineups((current) => current.map((item) => item.id === activeLineup.id ? { ...item, media: { ...item.media, [kind]: item.media[kind].filter((image) => image.key !== key) } } : item));
    pendingUploads.filter((upload) => upload.key === key).forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    setPendingUploads((current) => current.filter((upload) => upload.key !== key));
  }

  function updateActiveVideoBvid(videoBvid: string) {
    if (!activeLineup) return;
    setDraftLineups((current) => current.map((lineup) => (
      lineup.id === activeLineup.id ? { ...lineup, videoBvid } : lineup
    )));
    setValidation(null);
    setEditorNotice(null);
  }

  function updateActiveInstructions(instructions: string) {
    if (!activeLineup) return;
    setDraftLineups((current) => current.map((lineup) => (
      lineup.id === activeLineup.id ? { ...lineup, instructions } : lineup
    )));
    setEditorNotice(null);
  }

  async function openTeachingVideo(videoBvid: string) {
    setEditorNotice(null);
    try {
      await openBilibiliVideo(videoBvid);
    } catch (error) {
      setEditorNotice({ kind: 'error', text: editorError(error, '教学视频打开失败') });
    }
  }

  async function packageData(manifest: Manifest): Promise<PackageData> {
    const blobs = new Map<string, Blob>();
    for (const asset of manifest.uploadedAssets) blobs.set(asset.sha256, await readImage(asset));
    return { manifest, blobs };
  }

  async function currentEdits() {
    if (!isDirty && library.manual) return packageData(library.manual);
    if (!uploader) throw new Error('请先获取 B站身份再编辑');
    return buildManualPackage({
      previous: library.manual, packageId: manualIdRef.current, author: uploader,
      startLineups: savedLineups, lineups: draftLineups,
      image: async (lineupId, key) => {
        const pending = pendingUploads.find((upload) => upload.lineupId === lineupId && upload.key === key);
        if (pending) return pending.file;
        const local = sources.get(lineupId)?.uploadedAssets.find((asset) => asset.key === key);
        if (local) return readImage(local);
        const response = await fetch(assetUrl(key));
        if (!response.ok) throw new Error('无法读取点位图片，请重新添加图片或重新导入编辑包');
        return response.blob();
      },
    });
  }

  async function commitLibrary(next: LocalLibrary, data?: PackageData) {
    const urls = await libraryUrls(next, data?.blobs);
    try {
      const committed = await persistLibrary(library, next, data);
      setLibrary(committed);
      setImageUrls(urls);
    } catch (error) { urls.forEach((url) => URL.revokeObjectURL(url)); throw error; }
    setLightboxItem(null);
  }

  function validateEdits() {
    if (newLineupPlacement) return false;
    for (const lineup of draftLineups) {
      const field = !lineup.title.trim() ? 'title' : !lineup.area.trim() ? 'area' : lineup.videoBvid && !/^BV[0-9A-Za-z]{10}$/.test(lineup.videoBvid) ? 'videoBvid' : null;
      if (!field) continue;
      const message = field === 'title' ? '请填写点位名称' : field === 'area' ? '请填写区域或选择包点' : '请填写完整的 12 位 BV 号，或留空';
      setValidation({ id: lineup.id, field, message });
      setSelectedMapId(lineup.mapId);
      setSelectedAgentId(lineup.agentId);
      setSelectedLineupId(lineup.id);
      setSideFilter('all');
      setEditorNotice({ kind: 'error', text: message });
      requestAnimationFrame(() => detailPanelRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return false;
    }
    setValidation(null);
    return true;
  }

  async function saveEdits() {
    if (!isDirty || isEditorBusy || isPackageFull || !validateEdits()) return;
    setIsEditorBusy(true);
    setEditorNotice({ kind: 'info', text: '正在保存本地编辑及图片…' });
    try {
      const data = await currentEdits();
      const manual = packageStats(data.manifest).lineups ? data.manifest : null;
      await commitLibrary({ ...library, manual }, data);
      setDraftLineups(applyLayers(initialLineups, library.packages, manual).lineups);
      clearPendingUploads();
      setNewLineupId(null);
      setEditorNotice({ kind: 'success', text: '已保存到当前浏览器，点位和图片刷新后仍会保留。' });
    } catch (error) {
      setEditorNotice({ kind: 'error', text: editorError(error, '保存失败，草稿仍在当前页面') });
    } finally { setIsEditorBusy(false); }
  }

  async function exportEdits() {
    if (isEditorBusy || isPackageFull || (!isDirty && !library.manual) || !validateEdits()) return;
    setIsEditorBusy(true);
    try {
      const result = await downloadEditPackage(await currentEdits());
      setEditorNotice({ kind: 'success', text: `已下载一个完整编辑包：新增 ${result.added} / 修改 ${result.updated} / 删除 ${result.deleted} 个点位，${result.uploads} 张图片。${isDirty ? '当前修改尚未保存到浏览器。' : '已保存的编辑仍保留。'}` });
    } catch (error) { setEditorNotice({ kind: 'error', text: editorError(error, '导出失败') }); }
    finally { setIsEditorBusy(false); }
  }

  async function manageLibrary(next: LocalLibrary, data?: PackageData, successText = '已更新资料，保留你保存的点位修改。') {
    if (isEditorBusy || isEditing || !storageReady) return;
    setIsEditorBusy(true);
    try { await commitLibrary(next, data); setEditorNotice({ kind: 'success', text: successText }); }
    catch (error) { setEditorNotice({ kind: 'error', text: editorError(error, '本地更新失败') }); }
    finally { setIsEditorBusy(false); }
  }

  async function importPackage(file: File) {
    if (isEditorBusy || isEditing || !storageReady) return;
    setIsEditorBusy(true);
    try {
      if (file.size > MAX_PACKAGE_BYTES) throw new Error('编辑包超过 128 MB，请选择更小的文件');
      const data = await compressPackage(await readPackage(await file.arrayBuffer()), encodeWebp);
      validateReferences(data.manifest, maps, agents);
      const packages = [...library.packages];
      const index = packages.findIndex((item) => item.packageId === data.manifest.packageId);
      if (index < 0) packages.push(data.manifest); else packages[index] = data.manifest;
      await commitLibrary({ ...library, packages }, data);
      setEditorNotice({ kind: 'success', text: '更新包已导入并保存到当前浏览器，你保存的点位修改仍然保留。' });
    } catch (error) { setEditorNotice({ kind: 'error', text: editorError(error, '导入失败，原数据未改变') }); }
    finally { setIsEditorBusy(false); }
  }

  async function openUploader(uid: string) {
    try { await openBilibiliProfile(uid); }
    catch (error) { setEditorNotice({ kind: 'error', text: editorError(error, '主页打开失败') }); }
  }

  function sectionItems(kind: MediaKind) {
    if (!activeLineup) return [];
    const pendingByKey = new Map(activePendingUploads.map((upload) => [upload.key, upload]));
    return activeLineup.media[kind].map((item) => ({
      id: item.key,
      src: pendingByKey.get(item.key)?.previewUrl ?? (sources.has(activeLineup.id)
        ? imageUrls.get(sources.get(activeLineup.id)!.uploadedAssets.find((asset) => asset.key === item.key)?.sha256 ?? '')
        : assetUrl(item.key)),
      alt: item.alt,
      pending: pendingByKey.has(item.key),
    }));
  }

  return (
    <main
      className={`app-shell ${isEditMode ? 'is-editing' : ''}`}
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
                disabled={isEditorBusy}
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
        <div className="workspace-toolbar">
        <header className="topbar">
          <div>
            <p className="eyebrow">无畏契约 · LINEUP 图鉴</p>
            <h1>{showHistory ? '更新历史' : activeMap.name}</h1>
          </div>
          <div className="topbar-tools">
            <div className="agent-tabs" aria-label="英雄选择" style={showHistory ? { display: 'none' } : undefined}>
              {availableAgents.map((agent) => {
                const count = filteredMapLineups.filter((lineup) => lineup.agentId === agent.id).length;
                return (
                  <button
                    aria-pressed={agent.id === selectedAgentId}
                    className={`agent-tab ${agent.id === selectedAgentId ? 'is-active' : ''}`}
                    key={agent.id}
                    disabled={Boolean(newLineupId || newLineupPlacement)}
                    onClick={() => selectAgent(agent.id)}
                    type="button"
                  >
                    <img alt={agent.name} src={assetUrl(agent.icon)} />
                    <span><b>{agent.name}</b><small>{count} 个点位</small></span>
                  </button>
                );
              })}
            </div>
            {!showHistory ? <PackageImport compact disabled={!storageReady || isEditorBusy || isEditing} editing={isEditing} onImport={(file) => void importPackage(file)} /> : null}
            <button className="history-toggle" disabled={Boolean(newLineupPlacement || newLineupId) || isEditorBusy} onClick={() => { location.hash = showHistory ? '' : 'history'; }} type="button">{showHistory ? '返回图鉴' : '更新历史'}</button>

          </div>
        </header>

        <div className="editing-toolbar">
            {!isMobileView || library.manual || isEditing ? (
              <div className="editor-actions" aria-label="编辑工具">
                {isEditMode ? (
                  <>
                    <button className="editor-new" disabled={isEditorBusy || Boolean(newLineupPlacement) || Boolean(newLineupId)} onClick={beginNewLineupPlacement} type="button">＋ 新增点位</button>
                    <button className="editor-cancel" disabled={isEditorBusy} onClick={() => setIsExitConfirmOpen(true)} type="button">退出编辑</button>
                    <button className="editor-save" disabled={!isDirty || isEditorBusy || isPackageFull || Boolean(newLineupPlacement)} onClick={() => void saveEdits()} type="button">保存编辑</button>
                    <button className="editor-export" disabled={(!isDirty && !library.manual) || isEditorBusy || isPackageFull || Boolean(newLineupPlacement)} onClick={() => void exportEdits()} type="button">下载编辑包</button>
                  </>
                ) : (
                  <>
                    {!isMobileView ? <button className="editor-enter" disabled={!storageReady || isEditorBusy} onClick={() => void enterEditMode()} type="button">编辑点位</button> : null}
                    {library.manual ? <button className="editor-export" disabled={isEditorBusy} onClick={() => void exportEdits()} type="button">下载编辑包</button> : null}
                  </>
                )}
              </div>
            ) : null}
          {isEditing ? <div className="save-state" role="status" data-dirty={isDirty}>{isEditorBusy ? '正在处理…' : isDirty ? '有未保存修改' : library.manual ? '已保存到当前浏览器' : '暂无修改'}</div> : null}
        </div>

        <div className={`notice-slot ${editorNotice ? `is-${editorNotice.kind}` : ''}`} role="status">{editorNotice?.text ?? (newLineupPlacement ? '单击地图放置，按住拖动地图' : newLineupId ? '补充右侧资料后保存，也可以继续微调落点' : isEditing ? '拖动标点调整位置，修改完成后保存' : '')}</div>
        {isEditing || library.manual ? <div className={`package-size ${isPackageFull ? 'is-full' : ''}`} role="status"><span>编辑包图片：{formatBytes(packageImageBytes)} / {formatBytes(MAX_PACKAGE_BYTES)}</span><progress aria-label="编辑包图片容量" max={MAX_PACKAGE_BYTES} value={packageImageBytes} />{isPackageFull ? <small>已超限，请移除图片</small> : null}</div> : null}

        </div>
        {showHistory ? <HistoryPage packages={library.packages} manual={library.manual} dirty={isDirty} entries={content.history} maps={maps} busy={isEditorBusy || !storageReady} editing={isEditing}
          onImport={(file) => void importPackage(file)} onExport={() => void exportEdits()}
          onMove={(index, offset) => { const packages = [...library.packages]; [packages[index], packages[index + offset]] = [packages[index + offset], packages[index]]; void manageLibrary({ ...library, packages }); }}
          onRemove={(index) => setDeleteRequest({ kind: 'package', id: library.packages[index].packageId, author: library.packages[index].author.name })}
          onClearManual={() => setDeleteRequest({ kind: 'manual' })}
        /> : null}
        <div className="content-grid" style={showHistory ? { display: 'none' } : undefined} inert={isEditorBusy}>
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
                      disabled={Boolean(newLineupId || newLineupPlacement)}
                      onClick={() => selectSideFilter(filter)}
                      type="button"
                    >{sideFilterLabels[filter]}</button>
                  ))}
                </div>
                <div className="legend"><span /> {activeMap.sites.map((site) => site.label).join('/')} 包点 · {activeAgent?.name ?? '未选择英雄'} · {groups.length} 个落点</div>
              </div>
            </div>

            <div
              ref={mapStageRef}
              {...mapHandlers}
              aria-busy={mapImage.status === 'loading'}
              className={`map-stage ${mapViewport.zoom > MIN_ZOOM ? 'is-zoomed' : ''} ${mapViewport.zoom >= 4 ? 'is-detail-zoom' : ''} ${isDraggingMap ? 'is-dragging' : ''} ${isEditMode && newLineupPlacement ? 'is-placing' : ''}`}
              onDoubleClick={(event) => {
                if (newLineupPlacement || (event.target as HTMLElement).closest('button, input, [data-zoom-controls]') || mapImage.status !== 'ready') return;
                setZoom(mapViewport.zoom * 1.5, event.clientX, event.clientY);
              }}
              onPointerDown={handleMapPointerDown}
              onPointerUp={(event) => {
                mapClickPointRef.current = rawPointFromPointer(event.clientX, event.clientY);
                mapHandlers.onPointerUp(event);
              }}
              onClick={handleMapClick}
            >
              <div className="map-grid" />
              <div className="perspective-controls" data-zoom-controls aria-label="地图视角">
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
              <div className="map-zoom-controls">
                <ZoomControls label="地图" zoom={mapViewport.zoom} onZoom={setZoom} onReset={resetMapViewport} />
              </div>
              <div className="map-gesture-hint">{isEditMode ? '拖动标记修改落点 · 滚轮缩放地图' : '滚轮 / 双指缩放 · 放大后拖动地图 · 100%–800%'}</div>
              {mapImage.status !== 'ready' ? <div className="canvas-status" role="status">{mapImage.status === 'error' ? <>地图加载失败<button type="button" onClick={mapImage.retry}>重试</button></> : `正在加载${activeMap.name}…`}</div> : null}
              {isEditMode && newLineupPlacement ? (
                <div className="placement-banner" role="status">
                  <span><b>放置新点位</b>点击地图上的技能最终落点</span>
                  <button onClick={cancelNewLineup} type="button">取消新增</button>
                </div>
              ) : null}
              <div className="map-canvas" ref={mapCanvasRef} style={{ visibility: mapImage.status === 'ready' ? 'visible' : 'hidden' }}>
                <div
                  className="map-transform-layer"
                  style={{ transform: `translate3d(${mapViewport.x}px, ${mapViewport.y}px, 0) scale(${mapViewport.zoom}) rotate(${perspectiveRotation}deg)` }}
                >
                  <img key={activeMap.id} className="map-image" alt={`${activeMap.name}俯视地图`} draggable="false" src={assetUrl(activeMap.imageHiRes)} />
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
                      aria-label={`${representative.area}，${representative.title || '新增点位'}，${group.items.length} 种 Lineup${isEditMode ? '，可拖动' : ''}`}
                      aria-pressed={group.id === activeGroup?.id}
                      className={`lineup-pin ${representative.id === newLineupId ? 'is-new' : ''} ${group.id === activeGroup?.id ? 'is-active' : ''} ${isEditMode ? 'is-editable' : ''}`}
                      key={group.id}
                      disabled={Boolean(newLineupId && !group.items.some((item) => item.id === newLineupId)) || Boolean(newLineupPlacement)}
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
                      <span className="pin-label">{representative.title || '新增点位'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="detail-panel" ref={detailPanelRef} aria-label="点位资料">
            {newLineupPlacement ? (
              <div className="placement-guide"><span className="draft-badge">新增点位 · 选择落点</span><h2>在地图上放下标点</h2><p>点击技能最终落点，再填写名称、说明和截图。</p><p>滚轮缩放，按住地图拖动。切换地图后，请重新选择落点。</p><button className="new-lineup-cancel" onClick={cancelNewLineup} type="button">取消新增</button></div>
            ) : activeLineup && activeGroup ? (
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
                          disabled={Boolean(newLineupId)} onClick={() => setSelectedLineupId(lineup.id)}
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
                <h2>{activeLineup.title || '新增点位'}</h2>
                {newLineupId ? <div className="new-lineup-heading"><span className="draft-badge">新增 · 未保存</span><button className="new-lineup-cancel" disabled={isEditorBusy} onClick={cancelNewLineup} type="button">取消新增</button></div> : null}
                {isEditMode ? <section className="lineup-fields">
                  <label>点位名称<input aria-label="点位名称" maxLength={200} required aria-invalid={validation?.id === activeLineup.id && validation.field === 'title'} value={activeLineup.title} onChange={(event) => updateActiveFields({ title: event.target.value })} /></label>
                  {validation?.id === activeLineup.id && validation.field === 'title' ? <p className="field-error">{validation.message}</p> : null}
                  <label>阵营<select aria-label="点位阵营" value={activeLineup.side} onChange={(event) => updateActiveFields({ side: event.target.value as Perspective })}><option value="attack">进攻方</option><option value="defense">防守方</option></select></label>
                  <label>区域<input aria-label="点位区域" maxLength={100} required aria-invalid={validation?.id === activeLineup.id && validation.field === 'area'} value={activeLineup.area} onChange={(event) => updateActiveFields({ area: event.target.value })} /></label>
                  <div className="area-shortcuts" role="group" aria-label="快捷选择区域">{activeMap.sites.map((site) => <button type="button" key={site.label} aria-pressed={activeLineup.area === `${site.label}点`} onClick={() => updateActiveFields({ area: `${site.label}点` })}>{site.label}点</button>)}</div>
                  {validation?.id === activeLineup.id && validation.field === 'area' ? <p className="field-error">{validation.message}</p> : null}
                  <AgentPicker key={activeLineup.id} agents={agents} agentId={activeLineup.agentId} abilityId={activeLineup.abilityId} onChange={updateActiveFields} />
                  {!newLineupId ? <button className="lineup-delete" onClick={() => setDeleteRequest({ kind: 'lineup', id: activeLineup.id, title: activeLineup.title })} type="button">删除此点位</button> : null}
                </section> : null}
                <p className="uploader-line">上传者：<UploaderLabel uploader={activeLineup.uploader} onOpen={(uid) => void openUploader(uid)} /></p>
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
                {isEditMode ? <div className="coordinate-readout"><span>落点坐标</span><b>X {activeLineup.target.x.toFixed(5)}</b><b>Y {activeLineup.target.y.toFixed(5)}</b></div> : null}

                {isEditMode ? (
                  <label className="video-link-editor">
                    <span>B站教学视频 BV 号 <small>可留空</small></span>
                    <input
                      maxLength={12}
                      onChange={(event) => updateActiveVideoBvid(event.target.value.trim())}
                      pattern="BV[0-9A-Za-z]{10}"
                      placeholder="BV17x411w7KC"
                      value={activeLineup.videoBvid}
                      aria-label="教学视频 BV 号"
                      aria-invalid={validation?.id === activeLineup.id && validation.field === 'videoBvid'}
                    />
                  </label>
                ) : activeLineup.videoBvid ? (
                  <button className="video-link" onClick={() => void openTeachingVideo(activeLineup.videoBvid)} type="button">
                    <span><small>教学视频</small>观看完整操作演示</span><b aria-hidden="true">↗</b>
                  </button>
                ) : null}

                {validation?.id === activeLineup.id && validation.field === 'videoBvid' ? <p className="field-error">{validation.message}</p> : null}
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
                            disabled={!item.src}
                            onClick={() => { if (item.src) setLightboxItem({ src: item.src, alt: item.alt }); }}
                            type="button"
                          >
                            <img alt={item.alt} loading="lazy" src={item.src} />
                            <span aria-hidden="true">↗ 放大查看</span>
                          </button>
                          {item.pending ? <em>未保存</em> : !item.src ? <em>本地图片缺失，请重新导入原包</em> : null}
                          {isEditMode ? <button className="image-remove" type="button" onClick={() => removeImage(kind, item.id)}>删除此图片</button> : null}
                        </div>
                      ))}
                      {isEditMode ? (
                        <div className={`media-add-actions ${pasteTargetKind === kind ? 'is-paste-target' : ''}`}>
                          <label className="media-add">
                            <span>＋ 添加{mediaLabels[kind]}图</span>
                            <small>支持 PNG、JPG、WebP，单张不超过 12 MB</small>
                            <input
                              accept="image/png,image/jpeg,image/webp"
                              multiple
                              onChange={(event) => {
                                setPasteTargetKind(kind);
                                void addImages(kind, event.target.files);
                                event.currentTarget.value = '';
                              }}
                              type="file"
                            />
                          </label>
                          <button className="media-paste" aria-pressed={pasteTargetKind === kind} onClick={(event) => { setPasteTargetKind(kind); event.currentTarget.focus(); }} type="button">{pasteTargetKind === kind ? `✓ 已选中${mediaLabels[kind]}区域 · 按 Ctrl+V` : `选中${mediaLabels[kind]}区域以粘贴`}</button>
                          <small className="paste-hint">先复制图片，再选中区域，按 Ctrl+V / ⌘V；也可使用添加图片</small>
                        </div>
                      ) : null}
                    </section>
                  );
                })}

                {!sectionItems('effect').length ? (
                  <section className="effect-preview">
                    <p><span>03</span>效果落点</p>
                    <div style={{ visibility: mapImage.status === 'ready' ? 'visible' : 'hidden' }}>
                      <img alt="" className="effect-map" src={assetUrl(activeMap.imageHiRes)} style={{ transform: `rotate(${perspectiveRotation}deg)` }} />
                      {activeTargetPoint ? <i style={{ left: `${21.875 + activeTargetPoint.x * 56.25}%`, top: `${activeTargetPoint.y * 100}%` }} /> : null}
                      <strong>当前资料未包含游戏内效果截图</strong>
                    </div>
                  </section>
                ) : null}

                <p className="source-note">点位资料来自内置内容、导入的更新包和你保存的编辑</p>
              </>
            ) : (
              <div className="empty-state"><span>00</span><h2>还没有点位</h2><p>这里还没有对应的点位资料。进入编辑后，可以在地图上添加。</p></div>
            )}
          </aside>
        </div>
      </section>
      {isEditing && isExitConfirmOpen ? <ExitEditDialog dirty={isDirty} onCancel={() => setIsExitConfirmOpen(false)} onConfirm={exitEditMode} /> : null}
      {deleteRequest ? <ConfirmDialog
        title={deleteRequest.kind === 'manual' ? '删除本地编辑？' : deleteRequest.kind === 'package' ? '移除此更新包？' : '删除此点位？'}
        confirmLabel={deleteRequest.kind === 'manual' ? '删除本地编辑' : deleteRequest.kind === 'package' ? '移除更新包' : '确认删除点位'}
        onCancel={() => setDeleteRequest(null)} onConfirm={confirmDeletion}>
        {deleteRequest.kind === 'manual' ? <><p>已保存的手动编辑将从当前浏览器中删除，无法直接撤销。建议取消并先下载编辑包备份。</p><p>仓库点位和已导入的更新包不受影响。</p></>
          : deleteRequest.kind === 'package' ? <><p>移除由「{deleteRequest.author}」提供的更新包后，将按剩余更新包的顺序重新显示点位。</p><p>只影响当前浏览器，手动编辑仍然保留；可重新导入原包恢复。</p></>
            : <><p>即将删除「{deleteRequest.title}」。此操作会暂存在当前草稿，保存后生效。</p><p>退出编辑并放弃未保存变更，可以取消本次删除。</p></>}
      </ConfirmDialog> : null}
      {lightboxItem ? (
        <ImageLightbox key={lightboxItem.src} {...lightboxItem} onClose={() => setLightboxItem(null)} />
      ) : null}
    </main>
  );
}
