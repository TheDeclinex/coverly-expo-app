import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";

const DEFAULT_IMAGE_LOAD_RETRY_DELAYS_MS = [350, 900];

type ExpoImageProps = React.ComponentProps<typeof Image>;

interface ReliableImageProps extends Omit<ExpoImageProps, "source"> {
  uri: string | null | undefined;
  fallback?: React.ReactNode;
  retryDelaysMs?: number[];
  onPermanentError?: ExpoImageProps["onError"];
}

export function ReliableImage({
  uri,
  fallback = null,
  retryDelaysMs = DEFAULT_IMAGE_LOAD_RETRY_DELAYS_MS,
  onLoad,
  onError,
  onPermanentError,
  ...imageProps
}: ReliableImageProps) {
  const [hasError, setHasError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimeout = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    clearRetryTimeout();
    setHasError(false);
    setLoadAttempt(0);
    return clearRetryTimeout;
  }, [uri]);

  if (!uri || hasError) return <>{fallback}</>;

  const imageRenderKey = `${uri}:${loadAttempt}`;

  return (
    <Image
      {...imageProps}
      key={imageRenderKey}
      source={{ uri }}
      recyclingKey={imageRenderKey}
      cachePolicy={loadAttempt > 0 ? "none" : (imageProps.cachePolicy ?? "memory-disk")}
      onLoad={(event) => {
        clearRetryTimeout();
        onLoad?.(event);
      }}
      onError={(event) => {
        onError?.(event);
        const retryDelayMs = retryDelaysMs[loadAttempt];
        if (retryDelayMs != null) {
          clearRetryTimeout();
          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            setLoadAttempt((attempt) => attempt + 1);
          }, retryDelayMs);
          return;
        }
        setHasError(true);
        onPermanentError?.(event);
      }}
    />
  );
}
