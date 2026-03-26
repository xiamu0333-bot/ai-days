import React, { useState, useRef, useEffect } from 'react';
import { 
  Calendar, 
  Mic, 
  Image as ImageIcon, 
  Send, 
  Settings, 
  Download, 
  Trash2, 
  Plus, 
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface AIStudio {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}

declare global {
  interface Window {
    aistudio?: AIStudio;
  }
}

interface ScheduleItem {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  description: string;
  completed?: boolean;
}

// --- Utils ---
const formatTime = (isoString: string) => {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return isoString;
  }
};

const generateICS = (items: ScheduleItem[]) => {
  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Schedule Manager//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  items.forEach(item => {
    const start = new Date(item.startTime).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const end = new Date(item.endTime).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    icsContent.push('BEGIN:VEVENT');
    icsContent.push(`SUMMARY:${item.title}`);
    icsContent.push(`DTSTART:${start}`);
    icsContent.push(`DTEND:${end}`);
    icsContent.push(`DESCRIPTION:${item.description}`);
    icsContent.push('END:VEVENT');
  });

  icsContent.push('END:VCALENDAR');
  return icsContent.join('\r\n');
};

export default function App() {
  // --- State ---
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState(() => {
    const saved = localStorage.getItem('zhipu_api_key') || localStorage.getItem('gemini_api_key');
    if (saved && saved !== 'undefined' && saved !== 'null') return saved;
    return '';
  });
  const [showSettings, setShowSettings] = useState(!apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);

  const recognitionRef = useRef<any>(null);

  // --- Auto-clear alerts ---
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // --- Speech Recognition Setup ---
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'zh-CN';

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            setInputText(prev => prev + event.results[i][0].transcript);
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsRecording(false);
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
    } else {
      setError(null);
      try {
        recognitionRef.current?.start();
        setIsRecording(true);
      } catch (e) {
        setError('无法启动语音识别，请检查权限。');
      }
    }
  };

  // --- Image Handling ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
    // 重置 input 的值，确保同一个文件可以被再次触发 onChange
    e.target.value = '';
  };

  // --- AI Processing ---
  const callZhipuAI = async (key: string, model: string, systemPrompt: string, userContent: any) => {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  };

  const processSchedule = async () => {
    // Use UI key if provided, otherwise fallback to platform provided key
    const effectiveApiKey = apiKey.trim() || (process.env as any).API_KEY || (process.env as any).ZHIPU_API_KEY || '';

    if (!effectiveApiKey) {
      setError('请先在设置中输入 智谱 AI API Key。');
      setShowSettings(true);
      return;
    }

    if (!inputText && !selectedImage) {
      setError('请输入内容或上传图片。');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    const now = new Date();
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const currentTime = now.toLocaleString();
    const currentDay = days[now.getDay()];

    try {
      const systemInstruction = `
        你是一个专业的日程规划专家。你的任务是从用户的文本输入或图片（如课表、会议通知、聊天截图）中提取日程信息。
        
        当前时间上下文：
        - 现在时间：${currentTime}
        - 今天是：${currentDay}
        
        当前已有的日程安排如下（供参考，避免重复或用于冲突处理）：
        ${JSON.stringify(schedules, null, 2)}

        要求：
        1. 准确识别任务标题、开始时间、结束时间、详情描述。
        2. 如果是图片，请仔细解析网格布局，确保时间对应准确。
        3. 如果年份缺失，默认使用当前年份 ${now.getFullYear()}。
        4. 必须返回严格的 JSON 格式。
        5. 即使没有提取到内容，也请返回一个空的数组，例如 {"schedules": []}。
        6. JSON 结构必须是一个对象，包含一个 "schedules" 数组，数组中每个对象包含：title, startTime, endTime, description。
        7. 如果无法确定结束时间，请根据任务类型合理预估（如会议通常1小时）。
        8. startTime 和 endTime 必须是 ISO 8601 格式。
        9. 如果新提取的日程与已有日程在时间上存在冲突，请在返回的 JSON 中包含该日程，前端会自动处理覆盖逻辑。
      `;

      let userContent: any;
      if (selectedImage) {
        userContent = [
          { type: "text", text: inputText || "请分析这张图片并提取日程。" },
          { 
            type: "image_url", 
            image_url: { url: selectedImage } 
          }
        ];
      } else {
        userContent = inputText;
      }

      let resultText = '';
      try {
        // Primary model: glm-4.6v-flash
        resultText = await callZhipuAI(effectiveApiKey, "glm-4.6v-flash", systemInstruction, userContent);
      } catch (primaryErr: any) {
        console.warn('Primary model failed, trying fallback...', primaryErr);
        // Fallback if busy or error: GLM-4.1V-Thinking-Flash
        if (primaryErr.message.includes('busy') || primaryErr.message.includes('limit') || primaryErr.message.includes('503') || primaryErr.message.includes('429')) {
          resultText = await callZhipuAI(effectiveApiKey, "GLM-4.1V-Thinking-Flash", systemInstruction, userContent);
        } else {
          throw primaryErr;
        }
      }

      if (!resultText) {
        throw new Error("模型未返回任何内容");
      }

      const parsed = JSON.parse(resultText);
      const newItems = parsed.schedules || [];
      
      const itemsWithId = newItems.map((item: any) => ({
        ...item,
        id: Math.random().toString(36).substr(2, 9),
        completed: false
      }));

      if (itemsWithId.length === 0) {
        setError('未从输入中识别到任何日程信息，请尝试更清晰的描述或图片。');
        setIsLoading(false);
        return;
      }

      setSchedules(prev => {
        const updatedSchedules = [...prev];
        
        itemsWithId.forEach((newItem: any) => {
          const newStart = new Date(newItem.startTime).getTime();
          const newEnd = new Date(newItem.endTime).getTime();

          const conflictIndices: number[] = [];
          updatedSchedules.forEach((oldItem, index) => {
            const oldStart = new Date(oldItem.startTime).getTime();
            const oldEnd = new Date(oldItem.endTime).getTime();

            if (newStart < oldEnd && newEnd > oldStart) {
              conflictIndices.push(index);
            }
          });

          if (conflictIndices.length > 0) {
            for (let i = conflictIndices.length - 1; i >= 0; i--) {
              updatedSchedules.splice(conflictIndices[i], 1);
            }
          }
          updatedSchedules.push(newItem);
        });

        return updatedSchedules.sort((a, b) => 
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
      });
      
      setSuccess(`成功添加了 ${itemsWithId.length} 条日程！`);
      setInputText('');
      setSelectedImage(null);
    } catch (err: any) {
      console.error('AI Processing Error:', err);
      let errorMessage = err.message || '未知错误';
      
      // Try to parse JSON error from API
      try {
        if (errorMessage.includes('{')) {
          const jsonStart = errorMessage.indexOf('{');
          const jsonStr = errorMessage.substring(jsonStart);
          const parsedError = JSON.parse(jsonStr);
          if (parsedError.error?.message) {
            errorMessage = parsedError.error.message;
          }
        }
      } catch (e) {
        // Fallback to original message
      }

      if (errorMessage.includes('API key not valid')) {
        errorMessage = 'API Key 无效，请检查输入是否正确。';
        setShowSettings(true);
      }
      
      setError('处理失败：' + errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const exportToICS = () => {
    if (schedules.length === 0) return;
    const icsString = generateICS(schedules);
    const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', `schedule_${new Date().toISOString().split('T')[0]}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleComplete = (id: string) => {
    setSchedules(prev => prev.map(item => 
      item.id === id ? { ...item, completed: !item.completed } : item
    ));
  };

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    localStorage.setItem('zhipu_api_key', val);
  };

  const testApiKey = async () => {
    const effectiveApiKey = apiKey.trim() || (process.env as any).API_KEY || (process.env as any).ZHIPU_API_KEY || '';
    if (!effectiveApiKey) {
      setError('请先在设置中输入 API Key。');
      return;
    }
    setIsTestingKey(true);
    setError(null);
    try {
      await callZhipuAI(effectiveApiKey, "glm-4.6v-flash", "You are a helpful assistant.", "test");
      setSuccess('API Key 验证成功！');
    } catch (err: any) {
      console.error(err);
      let msg = err.message || '验证失败';
      if (msg.includes('401') || msg.includes('invalid')) msg = 'API Key 无效';
      setError('验证失败：' + msg);
    } finally {
      setIsTestingKey(false);
    }
  };

  const useOfficialKey = async () => {
    if (window.aistudio) {
      try {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await window.aistudio.openSelectKey();
        }
        setSuccess('已连接官方密钥，您可以开始使用了。');
        setShowSettings(false);
      } catch (e) {
        setError('无法连接官方密钥，请尝试手动输入。');
      }
    }
  };

  return (
    <div className="min-h-screen max-w-md mx-auto flex flex-col font-sans bg-gray-50">
      {/* Header */}
      <header className="glass sticky top-0 z-30 px-6 py-4 flex justify-between items-center border-b border-gray-200/50">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-xl">
            <Calendar className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">AI 日程管家</h1>
        </div>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-xl transition-colors ${showSettings ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-6 py-4 space-y-6 no-scrollbar" style={{ paddingBottom: '280px' }}>
        {/* Settings / API Key Input */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm space-y-3 mb-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">智谱 AI API Key</label>
                  <a 
                    href="https://open.bigmodel.cn/usercenter/apikeys" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    获取密钥
                  </a>
                </div>
                <div className="relative">
                  <input 
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="输入您的 智谱 AI API Key..."
                    className="w-full bg-gray-50 border-none focus:ring-2 focus:ring-blue-500 rounded-xl text-sm p-3 pr-20"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button 
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="p-1 text-gray-400 hover:text-gray-600"
                      title={showApiKey ? "隐藏" : "显示"}
                    >
                      {showApiKey ? <X className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
                    </button>
                    {apiKey && (
                      <button 
                        onClick={() => handleApiKeyChange('')}
                        className="p-1 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={testApiKey}
                    disabled={isTestingKey}
                    className="flex-1 bg-blue-50 text-blue-600 py-2 rounded-xl text-xs font-bold hover:bg-blue-100 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {isTestingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    测试连接
                  </button>
                  {window.aistudio && (
                    <button 
                      onClick={useOfficialKey}
                      className="flex-1 bg-gray-50 text-gray-600 py-2 rounded-xl text-xs font-bold hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
                    >
                      <Settings className="w-3 h-3" />
                      官方密钥
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  密钥将保存在您的浏览器本地。我们不会在服务器端存储您的密钥。
                  <a 
                    href="https://open.bigmodel.cn/pricing" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline block mt-1"
                  >
                    关于计费与配额
                  </a>
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Alert */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
              <button onClick={() => setError(null)}>
                <X className="w-4 h-4 text-red-400" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Alert */}
        <AnimatePresence>
          {success && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-green-50 border border-green-100 p-4 rounded-2xl flex items-start gap-3"
            >
              <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-green-700 font-medium">{success}</p>
              </div>
              <button onClick={() => setSuccess(null)}>
                <X className="w-4 h-4 text-green-400" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Timeline Section */}
        <section>
          <div className="flex justify-between items-end mb-4">
            <h2 className="text-lg font-semibold text-gray-900">今日日程</h2>
            {schedules.length > 0 && (
              <button 
                onClick={() => setSchedules([])}
                className="text-xs text-red-500 font-medium flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> 清空
              </button>
            )}
          </div>

          {schedules.length === 0 ? (
            <div className="bg-white rounded-3xl p-10 text-center ios-shadow border border-gray-100">
              <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-gray-400 text-sm">暂无日程，快去添加吧</p>
            </div>
          ) : (
            <div className="space-y-4 relative before:absolute before:left-[19px] before:top-4 before:bottom-4 before:w-0.5 before:bg-blue-100">
              {schedules.map((item, idx) => (
                <motion.div 
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="relative pl-12"
                >
                  <div className="absolute left-0 top-1.5 w-10 h-10 bg-white rounded-full border-4 border-blue-50 flex items-center justify-center z-0">
                    <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />
                  </div>
                  <div className={`bg-white p-4 rounded-2xl ios-shadow border border-gray-100 transition-all ${item.completed ? 'opacity-50' : 'opacity-100'}`}>
                    <div className="flex justify-between items-start mb-1 gap-2">
                      <div className="flex-1">
                        <h3 className={`font-bold text-gray-900 transition-all ${item.completed ? 'line-through text-gray-400' : ''}`}>
                          {item.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider transition-all ${item.completed ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600'}`}>
                          {formatTime(item.startTime)}
                        </span>
                        <button 
                          onClick={() => toggleComplete(item.id)}
                          className={`transition-all ${item.completed ? 'text-green-500' : 'text-gray-300 hover:text-blue-500'}`}
                        >
                          <CheckCircle2 className={`w-5 h-5 ${item.completed ? 'fill-green-50' : ''}`} />
                        </button>
                      </div>
                    </div>
                    <p className={`text-xs transition-all line-clamp-2 ${item.completed ? 'text-gray-300' : 'text-gray-500'}`}>
                      {item.description}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>{formatTime(item.startTime)} - {formatTime(item.endTime)}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Input Area */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto glass border-t border-gray-200/50 p-4 pb-8 space-y-4 z-20">
        {/* Image Preview */}
        {selectedImage && (
          <div className="relative inline-block">
            <img 
              src={selectedImage} 
              alt="Preview" 
              className="w-20 h-20 object-cover rounded-xl border-2 border-white shadow-sm"
            />
            <button 
              onClick={() => setSelectedImage(null)}
              className="absolute -top-2 -right-2 bg-gray-900 text-white rounded-full p-1"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1 bg-gray-100 rounded-2xl p-2 flex flex-col">
            <textarea 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入日程或上传图片..."
              className="bg-transparent border-none focus:ring-0 text-sm p-2 resize-none h-20"
            />
            <div className="flex justify-between items-center px-2 pb-1">
              <div className="flex gap-3">
                <label className="cursor-pointer p-1 hover:bg-gray-200 rounded-lg transition-colors">
                  <ImageIcon className="w-5 h-5 text-gray-500" />
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleImageUpload}
                  />
                </label>
                <button 
                  onClick={toggleRecording}
                  className={`p-1 rounded-lg transition-colors ${isRecording ? 'bg-red-100 text-red-500 animate-pulse' : 'hover:bg-gray-200 text-gray-500'}`}
                >
                  <Mic className="w-5 h-5" />
                </button>
              </div>
              <span className="text-[10px] text-gray-400">
                {inputText.length} 字
              </span>
            </div>
          </div>
          
          <button 
            onClick={processSchedule}
            disabled={isLoading}
            className="bg-blue-600 disabled:bg-blue-300 text-white p-4 rounded-2xl shadow-lg shadow-blue-200 active:scale-95 transition-all"
          >
            {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
          </button>
        </div>

        {schedules.length > 0 && (
          <button 
            onClick={exportToICS}
            className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-2xl flex items-center justify-center gap-2 font-semibold text-sm ios-shadow active:bg-gray-50"
          >
            <Download className="w-4 h-4" /> 导出为 .ics 文件
          </button>
        )}
      </div>
    </div>
  );
}
