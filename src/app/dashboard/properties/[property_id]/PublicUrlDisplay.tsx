"use client";

import { useState, useEffect } from "react";

interface PublicUrlDisplayProps {
  path: string;
}

export function PublicUrlDisplay({ path }: PublicUrlDisplayProps) {
  const [fullUrl, setFullUrl] = useState(path);

  useEffect(() => {
    setFullUrl(`${window.location.origin}${path}`);
  }, [path]);

  return (
    <div className="flex-1 rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm truncate">
      {fullUrl}
    </div>
  );
}
