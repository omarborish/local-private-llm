import { about } from "@/lib/about";
import { Button } from "@/components/ui/button";
import { ExternalLink, Shield } from "lucide-react";

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  const { contact } = about;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="z-50 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Local Private LLM</h2>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            v{about.version}
          </span>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <section>
            <h3 className="font-medium text-foreground">Purpose</h3>
            <p className="mt-1 text-muted-foreground">{about.whyBuilt}</p>
          </section>

          <section>
            <h3 className="font-medium text-foreground">Key features</h3>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
              {about.features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="font-medium text-foreground">Tech stack</h3>
            <p className="mt-1 text-muted-foreground">{about.techStack}</p>
          </section>

          <section>
            <h3 className="flex items-center gap-1.5 font-medium text-foreground">
              <Shield className="h-4 w-4" />
              Privacy
            </h3>
            <p className="mt-1 text-muted-foreground">{about.privacyPromise}</p>
          </section>

          {contact.links.length > 0 && (
            <section>
              <h3 className="font-medium text-foreground">Links</h3>
              <ul className="mt-2 space-y-1">
                {contact.links.map((link) => (
                  <li key={link.url}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                    >
                      {link.label} <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
