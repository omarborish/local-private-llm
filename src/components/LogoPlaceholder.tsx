import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Logo slot: loads from /logo.png (add logo.png to public/ folder) when present;
 * otherwise shows "LP" placeholder. Add public/logo.png or replace it to change the app logo.
 */
export function LogoPlaceholder({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  const logoSrc = "/logo.png";

  if (!failed) {
    return (
      <img
        src={logoSrc}
        alt="Logo"
        className={cn("h-8 w-8 shrink-0 rounded-md object-contain", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-secondary text-xs font-bold text-primary-foreground",
        className
      )}
      aria-hidden
    >
      LP
    </div>
  );
}
