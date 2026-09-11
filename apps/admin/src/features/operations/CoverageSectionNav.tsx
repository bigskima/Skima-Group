import { ArrowRight, Compass, Map, MapPinned, ShieldCheck, SlidersHorizontal, UsersRound, Wrench } from "lucide-react";

export type CoverageSection = "overview" | "availability" | "partners" | "map" | "diagnostics" | "maintenance";

const sections: readonly { key: CoverageSection; label: string; description: string; icon: typeof MapPinned }[] = [
  { key: "overview", label: "Overview", description: "Readiness and what needs attention", icon: Compass },
  { key: "availability", label: "Availability", description: "Mapped areas and service rules", icon: ShieldCheck },
  { key: "partners", label: "Partner coverage", description: "Driver and station operating areas", icon: UsersRound },
  { key: "map", label: "Map", description: "Visual coverage layers", icon: Map },
  { key: "diagnostics", label: "Diagnostics", description: "Check a point or assignment", icon: SlidersHorizontal },
  { key: "maintenance", label: "Maintenance", description: "Drafts, retention and expansion", icon: Wrench },
];

export function CoverageSectionNav(props: {
  readonly active: CoverageSection;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <nav className="coverage-v2__section-nav" aria-label="Service coverage screens">
      {sections.map((item) => {
        const Icon = item.icon;
        const active = item.key === props.active;
        return (
          <button
            key={item.key}
            type="button"
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
            onClick={() => props.onNavigate(coverageSectionHref(item.key))}
          >
            <Icon aria-hidden="true" />
            <span><strong>{item.label}</strong><small>{item.description}</small></span>
            <ArrowRight aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}

export function coverageSectionHref(section: CoverageSection) {
  return section === "overview" ? "/operations/coverage" : `/operations/coverage/${section}`;
}
