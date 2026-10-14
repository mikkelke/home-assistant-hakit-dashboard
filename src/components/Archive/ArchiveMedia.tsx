import type { ImgHTMLAttributes, VideoHTMLAttributes } from 'react';
import { useSeen, useSignedArchiveUrl } from '../../hooks/useArchiveMedia';

type Signed = {
  /** The file's unsigned /media/local/... path, as the archive index has it. */
  path: string;
  /** Sign only once the element scrolls near the viewport (gallery tiles). */
  lazy?: boolean;
};

/** An archive photo or map: signed when it mounts, or when it comes into view if `lazy`. */
export function ArchiveImage({ path, lazy = false, ...img }: Signed & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const [ref, seen] = useSeen<HTMLImageElement>();
  const { src, onError, onLoad } = useSignedArchiveUrl(path, !lazy || seen);
  return <img {...img} ref={lazy ? ref : undefined} src={src} onError={onError} onLoad={onLoad} />;
}

/** An archive clip, signed the same way. `fragment` (#t=0.1 paints a first frame on Safari) goes after the signature. */
export function ArchiveVideo({
  path,
  lazy = false,
  fragment = '',
  ...video
}: Signed & { fragment?: string } & Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const [ref, seen] = useSeen<HTMLVideoElement>();
  const { src, onError, onLoad } = useSignedArchiveUrl(path, !lazy || seen);
  return <video {...video} ref={lazy ? ref : undefined} src={src && src + fragment} onError={onError} onLoadedMetadata={onLoad} />;
}
