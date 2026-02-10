const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <main className="relative lg:pl-20 bg-light-primary dark:bg-dark-primary min-h-[100dvh] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(36,160,237,0.12),_transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(36,160,237,0.18),_transparent_55%)]" />
      <div className="relative max-w-screen-lg lg:mx-auto mx-4">{children}</div>
    </main>
  );
};

export default Layout;
