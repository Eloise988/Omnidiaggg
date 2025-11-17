
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { DiagnosticReport, RiskAssessment, RecommendedFix, TroubleshootingStep, HistoryEntry } from './types';
import { runDiagnostics } from './services/geminiService';
import { ReportSection } from './components/ReportSection';
import { UploadIcon, MicrophoneIcon, StopIcon, XCircleIcon, PaperAirplaneIcon, ExclamationTriangleIcon, ChevronDownIcon, ShieldCheckIcon } from './components/icons';
import { GoogleGenAI, Chat } from "@google/genai";


// SpeechRecognition might not be available on the window object in all browsers
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognition: any;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
}

const severityConfig: Record<RiskAssessment['severity'], { level: number; color: string; textColor: string }> = {
    'Low': { level: 1, color: 'bg-green-500/80', textColor: 'text-green-300' },
    'Medium': { level: 2, color: 'bg-yellow-500/80', textColor: 'text-yellow-300' },
    'High': { level: 3, color: 'bg-orange-500/80', textColor: 'text-orange-300' },
    'Critical': { level: 4, color: 'bg-red-600/80', textColor: 'text-red-300' },
};

const App: React.FC = () => {
    const [textInput, setTextInput] = useState<string>('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [audioTranscript, setAudioTranscript] = useState<string>('');
    const transcriptRef = useRef<string>('');

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<DiagnosticReport | null>(null);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    const [chat, setChat] = useState<Chat | null>(null);
    const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', text: string }[]>([]);
    const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
    const [chatInput, setChatInput] = useState<string>('');

    const [alertThreshold, setAlertThreshold] = useState<RiskAssessment['severity'] | 'None'>('None');
    const [activeAlert, setActiveAlert] = useState<string | null>(null);
    const [showAlertSettings, setShowAlertSettings] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!SpeechRecognition) return;

        recognition.onresult = (event: any) => {
            let interimTranscript = '';
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            transcriptRef.current = finalTranscript;
            setAudioTranscript(finalTranscript + interimTranscript);
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error', event.error);
            setError(`Speech recognition error: ${event.error}`);
            setIsRecording(false);
        };

        recognition.onend = () => {
            if(isRecording){
                try {
                    recognition.start();
                } catch(e){
                   console.error("Could not restart recognition", e)
                   setIsRecording(false);
                }
            }
        };

        return () => {
            if (recognition) {
                recognition.stop();
            }
        }
    }, [isRecording]);

    useEffect(() => {
        if(chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatHistory]);


    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = (reader.result as string).split(',')[1];
                setImageBase64(base64String);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRecordClick = () => {
        if (!SpeechRecognition) {
            setError("Sorry, your browser does not support Speech Recognition.");
            return;
        }
        if (isRecording) {
            recognition.stop();
            setIsRecording(false);
            setAudioTranscript(transcriptRef.current);
        } else {
            transcriptRef.current = '';
            setAudioTranscript('');
            recognition.start();
            setIsRecording(true);
        }
    };
    
    const clearImage = () => {
        setImageFile(null);
        setImageBase64(null);
        if(fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }

    const clearInputs = () => {
        setTextInput('');
        clearImage();
        setAudioTranscript('');
        transcriptRef.current = '';
        if (isRecording) {
            recognition.stop();
            setIsRecording(false);
        }
    }

    const handleSubmit = async () => {
        if (!textInput && !imageBase64 && !audioTranscript) {
            setError('Please provide a description, image, or voice note to start the diagnosis.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setReport(null);
        setActiveIndex(null);
        setChat(null);
        setChatHistory([]);
        setActiveAlert(null);


        try {
            const imagePayload = imageFile && imageBase64 ? { mimeType: imageFile.type, data: imageBase64 } : undefined;
            const newReport = await runDiagnostics(textInput, imagePayload, audioTranscript);
            setReport(newReport);
            
            if (alertThreshold !== 'None') {
                const severityLevels: Record<RiskAssessment['severity'], number> = {
                    'Low': 1,
                    'Medium': 2,
                    'High': 3,
                    'Critical': 4,
                };
                if (severityLevels[newReport.riskAssessment.severity] >= severityLevels[alertThreshold]) {
                    setActiveAlert(`Proactive Alert: The detected risk level is "${newReport.riskAssessment.severity}", which meets or exceeds your threshold of "${alertThreshold}".`);
                }
            }

            const newHistoryEntry: HistoryEntry = {
                id: Date.now().toString(),
                timestamp: new Date(),
                report: newReport,
                userInput: {
                    text: textInput,
                    image: !!imageFile,
                    audio: transcriptRef.current,
                }
            };

            setHistory(prevHistory => [newHistoryEntry, ...prevHistory]);
            setActiveIndex(0);
            
            if (process.env.API_KEY) {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                const systemInstruction = `You are OmniDiag, an expert AI diagnostic assistant. You've provided the user with a diagnostic report. Now, you must answer their follow-up questions. Maintain the persona of a helpful, expert assistant.
                
                HERE IS THE CONTEXT of the report you generated:
                ---
                Fault Summary: ${newReport.faultSummary}
                Possible Causes: ${newReport.possibleCauses.join(', ')}
                Risk: ${newReport.riskAssessment.severity} - ${newReport.riskAssessment.summary}
                ---
                Base all your answers on this context and the user's follow-up questions.`;
        
                const chatSession = ai.chats.create({
                    model: 'gemini-2.5-flash',
                    config: {
                        systemInstruction: systemInstruction,
                    },
                });
                setChat(chatSession);
            }
            clearInputs();

        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectHistory = (entry: HistoryEntry, index: number) => {
        const newReport = entry.report;
        setReport(newReport);
        setActiveIndex(index);
        setChatHistory([]);
        setActiveAlert(null);

        if (process.env.API_KEY) {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const systemInstruction = `You are OmniDiag, an expert AI diagnostic assistant. You've provided the user with a diagnostic report based on their initial submission. Now, you must answer their follow-up questions.
            
            CONTEXT of the report you generated:
            ---
            Fault Summary: ${newReport.faultSummary}
            Possible Causes: ${newReport.possibleCauses.join(', ')}
            Risk: ${newReport.riskAssessment.severity} - ${newReport.riskAssessment.summary}
            ---
            The user's original submission included: ${entry.userInput.text ? `A text description.` : ''} ${entry.userInput.image ? 'An image.' : ''} ${entry.userInput.audio ? 'A voice note.' : ''}
            Base all your answers on this context and the user's follow-up questions.`;
    
            const chatSession = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: {
                    systemInstruction: systemInstruction,
                },
            });
            setChat(chatSession);
        }
    }

    const handleClearHistory = () => {
        if (window.confirm('Are you sure you want to clear the entire diagnostic history? This action cannot be undone.')) {
            setHistory([]);
            setReport(null);
            setActiveIndex(null);
            setChat(null);
            setChatHistory([]);
        }
    };

    const handleSendChatMessage = async () => {
        if (!chatInput.trim() || !chat || isChatLoading) return;
    
        const text = chatInput;
        setChatInput('');
        setChatHistory(prev => [...prev, { role: 'user', text }]);
        setIsChatLoading(true);
    
        try {
            const responseStream = await chat.sendMessageStream({ message: text });
            setIsChatLoading(false);
            
            setChatHistory(prev => [...prev, { role: 'model', text: '' }]);
    
            for await (const chunk of responseStream) {
                const chunkText = chunk.text;
                setChatHistory(prev => {
                    const newHistory = [...prev];
                    newHistory[newHistory.length - 1].text += chunkText;
                    return newHistory;
                });
            }
        } catch (err) {
            console.error("Chat error:", err);
            setChatHistory(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error. Please try again.' }]);
            setIsChatLoading(false);
        }
    };

    return (
        <div className="min-h-screen text-slate-200">
            <main className="container mx-auto p-4 sm:p-6 lg:p-8">
                <header className="text-center mb-10 animate-fade-in" style={{ animationDelay: '100ms' }}>
                    <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-500">
                        OmniDiag
                    </h1>
                    <p className="mt-2 text-lg text-slate-400 max-w-2xl mx-auto">
                        Your AI-powered assistant for cross-domain fault detection and diagnostics.
                    </p>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Input Section */}
                    <div className="bg-slate-900/70 p-6 rounded-xl shadow-2xl backdrop-blur-lg glow-border animate-fade-in" style={{ animationDelay: '200ms' }}>
                        <h2 className="text-2xl font-bold mb-4 text-slate-100">Submit a Case</h2>
                        
                        <div className="border-b border-slate-700 mb-6 pb-6">
                            <button onClick={() => setShowAlertSettings(!showAlertSettings)} className="flex justify-between items-center w-full text-left p-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                                <h3 className="text-lg font-semibold text-slate-200">Alert Settings</h3>
                                <ChevronDownIcon className={`w-6 h-6 text-slate-400 transition-transform ${showAlertSettings ? 'rotate-180' : ''}`} />
                            </button>
                            {showAlertSettings && (
                                <div className="mt-4 pl-2">
                                    <label htmlFor="alert-threshold" className="block text-sm font-medium text-slate-300 mb-2">
                                        Notify me when risk is at least:
                                    </label>
                                    <select
                                        id="alert-threshold"
                                        value={alertThreshold}
                                        onChange={(e) => setAlertThreshold(e.target.value as RiskAssessment['severity'] | 'None')}
                                        className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all shadow-sm"
                                    >
                                        <option value="None">Disabled</option>
                                        <option value="Low">Low</option>
                                        <option value="Medium">Medium</option>
                                        <option value="High">High</option>
                                        <option value="Critical">Critical</option>
                                    </select>
                                </div>
                            )}
                        </div>
                        
                        <div className="space-y-6">
                            {/* Text Input */}
                            <div>
                                <label htmlFor="description" className="block text-sm font-medium text-slate-300 mb-2">Problem Description</label>
                                <textarea
                                    id="description"
                                    rows={5}
                                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all shadow-sm"
                                    placeholder="Describe the issue, including symptoms, sounds, or error codes..."
                                    value={textInput}
                                    onChange={(e) => setTextInput(e.target.value)}
                                />
                            </div>

                            {/* Image Upload */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Upload Image</label>
                                {imageBase64 ? (
                                    <div className="relative group">
                                        <img src={`data:${imageFile?.type};base64,${imageBase64}`} alt="Preview" className="w-full rounded-lg max-h-60 object-contain bg-black/20" />
                                        <button onClick={clearImage} className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5 text-white hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100">
                                            <XCircleIcon className="w-6 h-6"/>
                                        </button>
                                    </div>
                                ) : (
                                    <div 
                                        onClick={() => fileInputRef.current?.click()}
                                        className="relative block w-full border-2 border-slate-700 border-dashed rounded-lg p-8 text-center hover:border-cyan-500 cursor-pointer transition-colors"
                                    >
                                        <UploadIcon className="mx-auto h-12 w-12 text-slate-500" />
                                        <span className="mt-2 block text-sm font-medium text-slate-400">
                                            Click to upload a photo
                                        </span>
                                        <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />
                                    </div>
                                )}
                            </div>

                            {/* Voice Input */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Record Voice Note</label>
                                <button
                                    onClick={handleRecordClick}
                                    disabled={!SpeechRecognition}
                                    className={`w-full flex items-center justify-center p-3 rounded-lg font-semibold transition-all duration-300 ${isRecording ? 'bg-red-600 hover:bg-red-500 shadow-red-500/30' : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/30'} shadow-lg ${!SpeechRecognition && 'bg-slate-600 cursor-not-allowed'}`}
                                >
                                    {isRecording ? <StopIcon className="w-6 h-6 mr-2" /> : <MicrophoneIcon className="w-6 h-6 mr-2" />}
                                    {isRecording ? 'Stop Recording' : 'Start Recording'}
                                </button>
                                {audioTranscript && (
                                    <div className="mt-3 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                                        <p className="text-sm text-slate-400 italic">{audioTranscript}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="mt-8 border-t border-slate-700 pt-6">
                            <button
                                onClick={handleSubmit}
                                disabled={isLoading}
                                className="w-full bg-gradient-to-r from-cyan-500 to-fuchsia-600 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-wait flex items-center justify-center shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40"
                            >
                                {isLoading ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Analyzing...
                                    </>
                                ) : 'Run Diagnosis'}
                            </button>
                        </div>
                    </div>
                    
                    {/* Output Section */}
                    <div className="bg-slate-900/50 p-6 rounded-xl shadow-2xl backdrop-blur-lg glow-border flex flex-col animate-fade-in" style={{ animationDelay: '300ms' }}>
                        <h2 className="text-2xl font-bold mb-4 text-slate-100">Diagnostic Report</h2>
                        
                        {activeAlert && (
                            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 p-4 rounded-lg mb-4 flex items-start" role="alert">
                                <ExclamationTriangleIcon className="w-6 h-6 mr-3 flex-shrink-0" />
                                <div className="flex-grow">
                                    <p className="font-bold">Custom Alert Triggered</p>
                                    <p className="text-sm mt-1">{activeAlert}</p>
                                </div>
                                <button onClick={() => setActiveAlert(null)} className="ml-4 -mt-2 -mr-2 p-2 rounded-full hover:bg-amber-500/20" aria-label="Dismiss alert">
                                    <XCircleIcon className="w-5 h-5"/>
                                </button>
                            </div>
                        )}
                        
                        <div className='flex-grow overflow-y-auto pr-2 -mr-2'>
                            {isLoading && (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                    <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-cyan-400"></div>
                                    <p className="mt-4 text-lg">Generating intelligent analysis...</p>
                                </div>
                            )}
                            {error && (
                                <div className="flex items-center justify-center h-full">
                                    <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-4 rounded-lg text-center">
                                        <p className="font-bold">Analysis Failed</p>
                                        <p className="text-sm mt-1">{error}</p>
                                    </div>
                                </div>
                            )}
                            {!isLoading && !error && !report && (
                                <div className="flex items-center justify-center h-full text-center text-slate-500">
                                    <p>Your diagnostic report will appear here once analysis is complete.</p>
                                </div>
                            )}
                            {report && (
                                <>
                                    <ReportSection title="Fault Summary" icon={<i className="fas fa-exclamation-circle fa-fw"></i>}>
                                        <p>{report.faultSummary}</p>
                                    </ReportSection>

                                    <ReportSection title="Risk Assessment" icon={<i className="fas fa-shield-alt fa-fw"></i>}>
                                        {(() => {
                                            const { severity, summary, potentialConsequences, mitigationSteps } = report.riskAssessment;
                                            const config = severityConfig[severity] || { level: 0, color: 'bg-slate-500', textColor: 'text-slate-400' };
                                            
                                            return (
                                                <>
                                                    <div className="flex items-center mb-3">
                                                        <div className="flex items-end space-x-1.5 mr-3" aria-label={`Risk level: ${severity}`}>
                                                            {Array.from({ length: 4 }).map((_, index) => (
                                                                <div
                                                                    key={index}
                                                                    className={`w-3 rounded-full transition-all duration-300 ${index < config.level ? config.color : 'bg-slate-600'}`}
                                                                    style={{ height: `${8 + index * 4}px` }}
                                                                    title={`${index + 1} of 4`}
                                                                ></div>
                                                            ))}
                                                        </div>
                                                        <span className={`font-bold text-lg ${config.textColor}`}>
                                                            {severity}
                                                        </span>
                                                    </div>
                                                    <p className="mb-4">{summary}</p>
                                                    
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 border-t border-slate-700 pt-4">
                                                        <div>
                                                            <h4 className="font-semibold text-slate-200 mb-2 flex items-center">
                                                                <ExclamationTriangleIcon className="w-5 h-5 mr-2 text-orange-400" />
                                                                Potential Consequences
                                                            </h4>
                                                            {potentialConsequences?.length > 0 ? (
                                                                <ul className="list-disc list-inside space-y-1 text-sm">
                                                                    {potentialConsequences.map((item, i) => <li key={i}>{item}</li>)}
                                                                </ul>
                                                            ) : <p className="text-sm text-slate-500">None specified.</p>}
                                                        </div>
                                                        <div>
                                                            <h4 className="font-semibold text-slate-200 mb-2 flex items-center">
                                                                <ShieldCheckIcon className="w-5 h-5 mr-2 text-green-400" />
                                                                Mitigation Steps
                                                            </h4>
                                                            {mitigationSteps?.length > 0 ? (
                                                                <ul className="list-disc list-inside space-y-1 text-sm">
                                                                    {mitigationSteps.map((item, i) => <li key={i}>{item}</li>)}
                                                                </ul>
                                                            ) : <p className="text-sm text-slate-500">None specified.</p>}
                                                        </div>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </ReportSection>

                                    <ReportSection title="Possible Causes" icon={<i className="fas fa-search fa-fw"></i>}>
                                        <ul className="list-disc list-inside">
                                            {report.possibleCauses.map((cause, i) => <li key={i}>{cause}</li>)}
                                        </ul>
                                    </ReportSection>

                                    <ReportSection title="Troubleshooting Steps" icon={<i className="fas fa-list-ol fa-fw"></i>}>
                                        <ol className="list-decimal list-inside space-y-2">
                                            {report.troubleshootingSteps.map((step) => (
                                                <li key={step.step}>
                                                    <strong>{step.action}</strong>
                                                    <p className="text-sm text-slate-400 pl-4">{step.details}</p>
                                                </li>
                                            ))}
                                        </ol>
                                    </ReportSection>

                                    <ReportSection title="Recommended Fixes" icon={<i className="fas fa-wrench fa-fw"></i>}>
                                        <div className="space-y-3">
                                            {report.recommendedFixes.map((fix, i) => (
                                                <div key={i} className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                                                    <div className="font-semibold">{fix.fix} 
                                                    <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${fix.priority === 'Urgent' ? 'bg-red-500/30 text-red-300' : 'bg-green-500/30 text-green-300'}`}>{fix.priority}</span>
                                                    </div>
                                                    <p className="text-sm text-slate-400 mt-1">{fix.details}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </ReportSection>

                                    <ReportSection title="Required Tools & Potential Parts" icon={<i className="fas fa-toolbox fa-fw"></i>}>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <h4 className="font-semibold text-slate-200 mb-2">Recommended Tools</h4>
                                                {report.toolsAndParts.tools.length > 0 ? (
                                                    <ul className="list-disc list-inside space-y-1">
                                                        {report.toolsAndParts.tools.map((tool, i) => <li key={i}>{tool}</li>)}
                                                    </ul>
                                                ) : <p className="text-sm text-slate-500">None specified.</p>}
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-slate-200 mb-2">Potential Parts</h4>
                                                {report.toolsAndParts.parts.length > 0 ? (
                                                    <ul className="list-disc list-inside space-y-1">
                                                        {report.toolsAndParts.parts.map((part, i) => <li key={i}>{part}</li>)}
                                                    </ul>
                                                ) : <p className="text-sm text-slate-500">None specified.</p>}
                                            </div>
                                        </div>
                                    </ReportSection>

                                    <ReportSection title="Simplified Explanation" icon={<i className="fas fa-user-friends fa-fw"></i>}>
                                        <p>{report.simplifiedExplanation}</p>
                                    </ReportSection>
                                </>
                            )}
                        </div>
                         {report && chat && (
                            <div className="mt-6 border-t border-slate-700 pt-6 flex-shrink-0">
                                <h3 className="text-xl font-bold text-slate-100 mb-4">Interactive Follow-up</h3>
                                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 h-64 overflow-y-auto space-y-4" ref={chatContainerRef}>
                                    {chatHistory.map((msg, index) => (
                                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-lg ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                                                <p className="text-white whitespace-pre-wrap">{msg.text}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {isChatLoading && chatHistory[chatHistory.length - 1]?.role === 'user' && (
                                        <div className="flex justify-start">
                                            <div className="max-w-xs px-4 py-2 rounded-lg bg-slate-700">
                                                <div className="flex items-center space-x-1">
                                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:-0.3s]"></span>
                                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:-0.15s]"></span>
                                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4 flex">
                                    <input
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => {if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChatMessage();}}}
                                        placeholder="Ask a follow-up question..."
                                        className="flex-grow bg-slate-700 border border-slate-600 rounded-l-lg p-3 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all text-white"
                                    />
                                    <button
                                        onClick={handleSendChatMessage}
                                        disabled={!chatInput.trim() || isChatLoading}
                                        className="bg-cyan-600 text-white p-3 rounded-r-lg hover:bg-cyan-500 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed flex items-center justify-center"
                                        aria-label="Send message"
                                    >
                                        <PaperAirplaneIcon className="w-6 h-6" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* History Section */}
                <div className="mt-12 animate-fade-in" style={{ animationDelay: '400ms' }}>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-slate-100">Diagnostic History</h2>
                        {history.length > 0 && (
                            <button
                                onClick={handleClearHistory}
                                className="flex items-center text-sm bg-slate-800/50 hover:bg-red-800/60 text-slate-300 hover:text-white font-semibold py-2 px-3 rounded-lg transition-colors duration-200"
                                aria-label="Clear diagnostic history"
                            >
                                <i className="fas fa-trash-alt fa-fw mr-2"></i>
                                Clear History
                            </button>
                        )}
                    </div>
                    <div className="bg-slate-900/70 p-4 rounded-xl shadow-2xl backdrop-blur-lg glow-border max-h-96 overflow-y-auto">
                        {history.length > 0 ? (
                            <ul className="space-y-2">
                                {history.map((entry, index) => (
                                    <li key={entry.id}>
                                        <button
                                            onClick={() => handleSelectHistory(entry, index)}
                                            className={`w-full text-left p-3 rounded-lg transition-colors duration-200 ${activeIndex === index ? 'bg-cyan-500/10' : 'hover:bg-slate-800/50'}`}
                                        >
                                            <div className="font-semibold text-slate-100 truncate">{entry.report.faultSummary}</div>
                                            <div className="text-xs text-slate-400 mt-1">{entry.timestamp.toLocaleString()}</div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="text-center text-slate-500 py-8">
                                <p>Your past reports will be saved here for the current session.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;
