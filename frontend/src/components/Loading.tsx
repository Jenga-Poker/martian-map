type LoadingProps = {
  title?: string;
  subtitle?: string;
};

export default function Loading({
  title = "Loading",
  subtitle,
}: LoadingProps) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="app-loading__orbit" aria-hidden="true">
        <span className="app-loading__planet" />
        <span className="app-loading__moon" />
      </div>
      {title && <p className="app-loading__title">{title}</p>}
      {subtitle && <p className="app-loading__subtitle">{subtitle}</p>}
    </div>
  );
}
