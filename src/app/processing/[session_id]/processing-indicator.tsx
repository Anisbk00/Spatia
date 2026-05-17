"use client";

import { useEffect, useState } from "react";
import { Rotate3d } from "lucide-react";

export default function ProcessingIndicator() {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
      <Rotate3d className="h-10 w-10 animate-spin text-emerald-600" style={{ animationDuration: "3s" }} />
    </div>
  );
}
