export default function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="glass p-5">
      <div className="text-sm text-brand-200">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-brand-50">{value}</div>
      {hint && <div className="mt-1 text-xs text-white/40">{hint}</div>}
    </div>
  );
}
