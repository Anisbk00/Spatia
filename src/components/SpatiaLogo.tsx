import { cn } from "@/lib/utils";

interface SpatiaLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-9 w-9",
};

export function SpatiaLogo({ className, size = "md" }: SpatiaLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="none"
      className={cn(sizeMap[size], "rounded-lg shrink-0", className)}
      aria-label="Spatia"
    >
      {/* Background — solid emerald gradient replaced with single solid fill */}
      <rect width="512" height="512" rx="112" fill="#059669" />
      {/* Subtle spatial grid lines */}
      <path d="M256 128L384 192V320L256 384L128 320V192L256 128Z" stroke="white" strokeOpacity="0.08" strokeWidth="2" fill="none" />
      <path d="M256 168L344 212V300L256 344L168 300V212L256 168Z" stroke="white" strokeOpacity="0.06" strokeWidth="1.5" fill="none" />
      {/* S lettermark — primary stroke */}
      <path d="M310 148C310 148 280 132 248 132C216 132 186 148 186 178C186 208 216 218 250 228C284 238 326 250 326 292C326 338 290 368 248 368C216 368 192 356 178 348" stroke="white" strokeOpacity="0.9" strokeWidth="42" strokeLinecap="round" fill="none" />
      {/* S lettermark — depth shadow */}
      <path d="M316 154C316 154 286 138 254 138C222 138 192 154 192 184C192 214 222 224 256 234C290 244 332 256 332 298C332 344 296 374 254 374C222 374 198 362 184 354" stroke="white" strokeOpacity="0.45" strokeWidth="42" strokeLinecap="round" fill="none" />
      {/* Isometric cube accent — top right */}
      <path d="M388 148L416 164V196L388 212L360 196V164L388 148Z" fill="white" fillOpacity="0.25" />
      <path d="M388 148L416 164L388 180L360 164L388 148Z" fill="white" fillOpacity="0.4" />
      <path d="M388 180L416 164V196L388 212V180Z" fill="white" fillOpacity="0.2" />
      {/* Isometric cube accent — bottom left */}
      <path d="M124 300L152 316V348L124 364L96 348V316L124 300Z" fill="white" fillOpacity="0.15" />
      <path d="M124 300L152 316L124 332L96 316L124 300Z" fill="white" fillOpacity="0.25" />
      <path d="M124 332L152 316V348L124 364V332Z" fill="white" fillOpacity="0.1" />
    </svg>
  );
}
