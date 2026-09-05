import { useEffect, useState } from 'react';

export function useDecodedImage(src: string) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ src: '', attempt: -1, status: 'loading', aspect: 0 });
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.src = src;
    image.decode().then(() => {
      if (!cancelled) setResult({ src, attempt, status: 'ready', aspect: image.naturalWidth / image.naturalHeight });
    }).catch(() => {
      if (!cancelled) setResult({ src, attempt, status: 'error', aspect: 0 });
    });
    return () => { cancelled = true; };
  }, [src, attempt]);
  return { status: result.src === src && result.attempt === attempt ? result.status : 'loading', aspect: result.src === src ? result.aspect : 0, retry: () => setAttempt((value) => value + 1) };
}
