"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Link as LinkIcon } from "lucide-react";

interface CopyButtonProps {
  /** The relative path (e.g. /view/abc) — will be converted to full URL on client */
  path: string;
}

export function CopyButton({ path }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const fullUrl = typeof window !== "undefined"
    ? `${window.location.origin}${path}`
    : path;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[CopyButton] Clipboard API failed, using fallback:", err);
      const textarea = document.createElement("textarea");
      textarea.value = fullUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className="gap-1.5"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <LinkIcon className="h-3.5 w-3.5" />
          Copy
        </>
      )}
    </Button>
  );
}
