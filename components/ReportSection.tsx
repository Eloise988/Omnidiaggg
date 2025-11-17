
import React from 'react';

interface ReportSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

export const ReportSection: React.FC<ReportSectionProps> = ({ title, icon, children }) => {
  return (
    <div className="bg-slate-800/40 rounded-lg p-4 md:p-6 mb-6 backdrop-blur-sm border border-slate-700/50">
      <div className="flex items-center mb-4">
        <div className="text-cyan-400 mr-3 text-lg">{icon}</div>
        <h3 className="text-xl font-bold text-slate-100">{title}</h3>
      </div>
      <div className="text-slate-300 space-y-3 prose prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
        {children}
      </div>
    </div>
  );
};
