export function SectionDivider({ className }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-4 py-4 ${className ?? ""}`}>
      <span className="w-12 h-px bg-bg-subtle" />
      <span className="text-green-500 text-sm select-none">&diams;</span>
      <span className="w-12 h-px bg-bg-subtle" />
    </div>
  );
}
