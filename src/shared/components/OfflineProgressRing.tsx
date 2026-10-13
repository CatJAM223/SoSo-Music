type Props = { progress: number; size?: number };

export function OfflineProgressRing({ progress, size = 18 }: Props) {
  const circumference = 2 * Math.PI * 7;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      className="shrink-0 -rotate-90"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="text-soso-brand/20"
      />
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
        className="text-soso-brand transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}
