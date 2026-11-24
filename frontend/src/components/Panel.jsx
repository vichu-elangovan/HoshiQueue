function Panel({ children, className = "" }) {
  return (
    <section className={`rounded-2xl border border-slate-800/90 bg-[#0d1425] p-6 ${className}`}>
      {children}
    </section>
  );
}

export default Panel;
