export interface RiskAssessment {
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  summary: string;
  potentialConsequences: string[];
  mitigationSteps: string[];
}

export interface TroubleshootingStep {
  step: number;
  action: string;
  details: string;
}

export interface RecommendedFix {
  fix: string;
  priority: 'Recommended' | 'Optional' | 'Urgent';
  details: string;
}

export interface DiagnosticReport {
  faultSummary: string;
  possibleCauses: string[];
  riskAssessment: RiskAssessment;
  troubleshootingSteps: TroubleshootingStep[];
  recommendedFixes: RecommendedFix[];
  simplifiedExplanation: string;
  toolsAndParts: {
    tools: string[];
    parts: string[];
  };
}

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  report: DiagnosticReport;
  userInput: {
    text: string;
    image: boolean;
    audio: string;
  };
}
