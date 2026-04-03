/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Image as ImageIcon, 
  Download, 
  RotateCcw, 
  RotateCw, 
  Undo2, 
  Redo2, 
  SlidersHorizontal, 
  Palette, 
  Crop, 
  Pencil, 
  Sparkles,
  ChevronLeft,
  X,
  Check,
  Camera,
  Plus,
  Eraser,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Adjustment, INITIAL_ADJUSTMENTS, Tool } from './types';
import { GoogleGenAI } from "@google/genai";

// --- Components ---

const IconButton = ({ icon: Icon, label, onClick, active, className, tooltip, tooltipSide = 'bottom' }: any) => {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <div className="relative flex flex-col items-center">
      <button
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          "flex flex-col items-center justify-center gap-1 p-2 transition-all active:scale-90",
          active ? "text-blue-500" : "text-zinc-400",
          className
        )}
      >
        <Icon size={24} strokeWidth={active ? 2.5 : 2} />
        {label && <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>}
      </button>
      <AnimatePresence>
        {isHovered && tooltip && (
          <motion.div
            initial={{ opacity: 0, y: tooltipSide === 'bottom' ? 5 : -5, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: tooltipSide === 'bottom' ? 5 : -5, scale: 0.9 }}
            className={cn(
              "absolute px-2 py-1 bg-zinc-800 text-white text-[10px] font-bold rounded shadow-xl whitespace-nowrap z-[100] pointer-events-none border border-zinc-700",
              tooltipSide === 'bottom' ? "top-full mt-2" : "bottom-full mb-2"
            )}
          >
            {tooltip}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Slider = ({ label, value, min, max, step = 1, onChange, onReset }: any) => (
  <div className="w-full px-6 py-3 space-y-2">
    <div className="flex justify-between items-center text-xs font-medium text-zinc-400">
      <span className="uppercase tracking-widest">{label}</span>
      <button onClick={onReset} className="hover:text-white transition-colors">{value}</button>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
    />
  </div>
);

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('none');
  const [adjustments, setAdjustments] = useState<Adjustment>(INITIAL_ADJUSTMENTS);
  const [history, setHistory] = useState<Adjustment[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBlurIntensity, setAiBlurIntensity] = useState(50);
  const [exportQuality, setExportQuality] = useState<'low' | 'medium' | 'high'>('high');
  const [exportFormat, setExportFormat] = useState<'jpg' | 'png'>('jpg');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [showSettings, setShowSettings] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);

  const [brushColor, setBrushColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);

  const [cropRatio, setCropRatio] = useState<number | null>(null);

  // --- Image Loading ---

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        originalImageRef.current = img;
        setImage(event.target?.result as string);
        setAdjustments(INITIAL_ADJUSTMENTS);
        setHistory([INITIAL_ADJUSTMENTS]);
        setHistoryIndex(0);
        renderCanvas(img, INITIAL_ADJUSTMENTS);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const takePhoto = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      
      const dataUrl = canvas.toDataURL('image/png');
      const img = new Image();
      img.onload = () => {
        originalImageRef.current = img;
        setImage(dataUrl);
        setAdjustments(INITIAL_ADJUSTMENTS);
        setHistory([INITIAL_ADJUSTMENTS]);
        setHistoryIndex(0);
        renderCanvas(img, INITIAL_ADJUSTMENTS);
      };
      img.src = dataUrl;

      stream.getTracks().forEach(track => track.stop());
    } catch (err) {
      console.error("Camera access failed:", err);
    }
  };

  const [isComparing, setIsComparing] = useState(false);

  // --- Rendering Logic ---

  const renderCanvas = useCallback((img: HTMLImageElement, adj: Adjustment, ratio: number | null = null, compare: boolean = false) => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxWidth = window.innerWidth * 0.95;
    const maxHeight = window.innerHeight * 0.55;
    
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = img.width;
    let sourceHeight = img.height;

    if (ratio) {
      if (img.width / img.height > ratio) {
        sourceWidth = img.height * ratio;
        sourceX = (img.width - sourceWidth) / 2;
      } else {
        sourceHeight = img.width / ratio;
        sourceY = (img.height - sourceHeight) / 2;
      }
    }

    const drawRatio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
    const width = sourceWidth * drawRatio;
    const height = sourceHeight * drawRatio;

    canvas.width = width;
    canvas.height = height;
    
    if (drawingCanvasRef.current) {
      drawingCanvasRef.current.width = width;
      drawingCanvasRef.current.height = height;
    }

    if (compare) {
      ctx.filter = 'none';
    } else {
      ctx.filter = `
        brightness(${adj.brightness}%)
        contrast(${adj.contrast}%)
        saturate(${adj.saturation}%)
        hue-rotate(${adj.hue}deg)
        blur(${adj.blur}px)
        sepia(${adj.sepia}%)
        grayscale(${adj.grayscale}%)
      `;
    }

    ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  }, []);

  const applyCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const croppedData = canvas.toDataURL('image/png');
    const img = new Image();
    img.onload = () => {
      originalImageRef.current = img;
      setImage(croppedData);
      setCropRatio(null);
      saveToHistory();
      setActiveTool('none');
    };
    img.src = croppedData;
  };

  useEffect(() => {
    if (originalImageRef.current) {
      renderCanvas(originalImageRef.current, adjustments, cropRatio, isComparing);
    }
  }, [adjustments, renderCanvas, cropRatio, isComparing]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (activeTool !== 'draw') return;
    setIsDrawing(true);
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx) return;

    const pos = getPointerPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || activeTool !== 'draw') return;
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx) return;

    const pos = getPointerPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const getPointerPos = (e: any) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const clearDrawings = () => {
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (ctx && drawingCanvasRef.current) {
      ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    }
  };

  const mergeAndSave = () => {
    const canvas = canvasRef.current;
    const drawCanvas = drawingCanvasRef.current;
    if (!canvas || !drawCanvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(canvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);
    
    const mergedData = tempCanvas.toDataURL('image/png');
    const img = new Image();
    img.onload = () => {
      originalImageRef.current = img;
      setImage(mergedData);
      clearDrawings();
      saveToHistory();
      setActiveTool('none');
    };
    img.src = mergedData;
  };

  useEffect(() => {
    if (originalImageRef.current) {
      renderCanvas(originalImageRef.current, adjustments);
    }
  }, [adjustments, renderCanvas]);

  // --- Actions ---

  const updateAdjustment = (key: keyof Adjustment, value: number) => {
    setAdjustments(prev => ({ ...prev, [key]: value }));
  };

  const saveToHistory = () => {
    let newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ ...adjustments });
    
    if (newHistory.length > historyLimit) {
      newHistory = newHistory.slice(newHistory.length - historyLimit);
    }
    
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setAdjustments(prev);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setAdjustments(next);
      setHistoryIndex(historyIndex + 1);
    }
  };

  const downloadImage = () => {
    const canvas = canvasRef.current;
    const drawCanvas = drawingCanvasRef.current;
    if (!canvas || !drawCanvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;

    // Fill background for JPEG
    if (exportFormat === 'jpg') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    }
    
    ctx.drawImage(canvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);

    const qualityMap = { low: 0.3, medium: 0.6, high: 0.9 };
    const quality = qualityMap[exportQuality];

    const link = document.createElement('a');
    link.download = `lumina-edit-${exportQuality}.${exportFormat}`;
    link.href = tempCanvas.toDataURL(exportFormat === 'jpg' ? 'image/jpeg' : 'image/png', exportFormat === 'jpg' ? quality : undefined);
    link.click();
    setShowExportMenu(false);
  };

  // --- AI Tools ---

  const handleAiEdit = async (customPrompt?: string) => {
    const prompt = customPrompt || aiPrompt;
    if (!prompt || !image) return;
    setIsProcessing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [
            { inlineData: { data: image.split(',')[1], mimeType: 'image/png' } },
            { text: prompt },
          ],
        },
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const newImageBase64 = `data:image/png;base64,${part.inlineData.data}`;
          const img = new Image();
          img.onload = () => {
            originalImageRef.current = img;
            setImage(newImageBase64);
            setAdjustments(INITIAL_ADJUSTMENTS);
            saveToHistory();
          };
          img.src = newImageBase64;
        }
      }
    } catch (error) {
      console.error("AI Edit failed:", error);
    } finally {
      setIsProcessing(false);
      if (!customPrompt) setAiPrompt('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black text-white font-sans flex flex-col overflow-hidden select-none">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-4 border-b border-zinc-900/50 backdrop-blur-xl z-50">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setImage(null)} 
            className="p-2 text-zinc-400 hover:text-white transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-sm font-bold tracking-widest text-blue-500">LUMINA</h1>
        </div>
        
        <div className="flex items-center gap-2 relative">
          <IconButton 
            icon={Undo2} 
            onClick={undo} 
            active={historyIndex > 0} 
            tooltip="Undo (Ctrl+Z)"
          />
          <IconButton 
            icon={Redo2} 
            onClick={redo} 
            active={historyIndex < history.length - 1} 
            tooltip="Redo (Ctrl+Y)"
          />

          <IconButton 
            icon={Settings} 
            onClick={() => setShowSettings(!showSettings)} 
            active={showSettings}
            tooltip="Settings"
          />
          
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={!image}
              className="ml-2 px-6 py-2 bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-full text-xs font-black tracking-widest transition-all active:scale-95"
            >
              EXPORT
            </button>

            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  className="absolute top-full right-0 mt-2 w-64 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-4 z-[60]"
                >
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-800">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Preferences</span>
                    <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-white">
                      <X size={14} />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                        <span>History Depth</span>
                        <span className="text-blue-500">{historyLimit} steps</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="100"
                        step="5"
                        value={historyLimit}
                        onChange={(e) => setHistoryLimit(Number(e.target.value))}
                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <p className="text-[9px] text-zinc-600 leading-relaxed font-medium">
                        Limit the number of undo/redo steps stored in memory. Higher values use more RAM.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showExportMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  className="absolute top-full right-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-2 z-[60]"
                >
                  <div className="px-3 py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest border-b border-zinc-800 mb-1">
                    Format
                  </div>
                  <div className="flex gap-1 p-1 bg-zinc-950 rounded-xl mb-2">
                    {(['jpg', 'png'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setExportFormat(f)}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                          exportFormat === f ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                        )}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  <div className="px-3 py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest border-b border-zinc-800 mb-1">
                    Quality
                  </div>
                  {(['low', 'medium', 'high'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => setExportQuality(q)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-between",
                        exportQuality === q ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
                      )}
                    >
                      <span className="capitalize">{q}</span>
                      {exportQuality === q && <Check size={14} strokeWidth={3} />}
                    </button>
                  ))}
                  <button
                    onClick={downloadImage}
                    className="w-full mt-2 py-2.5 bg-white text-black rounded-xl text-[10px] font-black tracking-widest uppercase hover:bg-zinc-200 transition-all active:scale-95"
                  >
                    Download
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 relative flex items-center justify-center p-4 bg-zinc-950 overflow-hidden">
        {!image ? (
          <div className="flex flex-col items-center gap-8 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500 blur-3xl opacity-20 animate-pulse" />
              <div className="w-32 h-32 bg-zinc-900 rounded-[2.5rem] flex items-center justify-center shadow-2xl border border-zinc-800 relative">
                <ImageIcon size={48} className="text-blue-500" />
              </div>
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl font-black tracking-tight">Professional Editor</h2>
              <p className="text-zinc-500 text-sm max-w-[280px] leading-relaxed">
                Unlock the full potential of your photos with Lumina's advanced tools.
              </p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-8 py-4 bg-blue-600 text-white rounded-full font-black text-sm shadow-2xl shadow-blue-500/20 hover:bg-blue-500 transition-all active:scale-95 flex items-center gap-3"
              >
                <ImageIcon size={20} />
                GALLERY
              </button>
              <button
                onClick={takePhoto}
                className="px-8 py-4 bg-zinc-800 text-white rounded-full font-black text-sm shadow-2xl hover:bg-zinc-700 transition-all active:scale-95 flex items-center gap-3"
              >
                <Camera size={20} />
                CAMERA
              </button>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
            />
          </div>
        ) : (
          <div className="relative group touch-none">
            <canvas
              ref={canvasRef}
              className="rounded-xl shadow-2xl transition-all duration-500"
            />
            <canvas
              ref={drawingCanvasRef}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className={cn(
                "absolute top-0 left-0 w-full h-full rounded-xl pointer-events-none",
                activeTool === 'draw' && "pointer-events-auto cursor-crosshair"
              )}
            />
            
            {/* Compare Button */}
            <button
              onMouseDown={() => setIsComparing(true)}
              onMouseUp={() => setIsComparing(false)}
              onMouseLeave={() => setIsComparing(false)}
              onTouchStart={() => setIsComparing(true)}
              onTouchEnd={() => setIsComparing(false)}
              className="absolute top-4 right-4 px-4 py-2 bg-black/50 backdrop-blur-md rounded-full text-[10px] font-black tracking-widest uppercase border border-white/10 active:scale-90 transition-all"
            >
              Compare
            </button>

            {isProcessing && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-md rounded-xl flex flex-col items-center justify-center gap-6 z-50">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-blue-500/20 rounded-full" />
                  <div className="absolute inset-0 w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-xs font-black tracking-[0.3em] uppercase text-blue-500">AI Processing</p>
                  <p className="text-[10px] text-zinc-400 font-medium">Reimagining your photo...</p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Tool Controls */}
      <AnimatePresence mode="wait">
        {activeTool !== 'none' && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-24 left-0 right-0 bg-zinc-900/95 backdrop-blur-3xl border-t border-zinc-800/50 z-40 shadow-2xl"
          >
            <div className="max-h-80 overflow-y-auto py-6 no-scrollbar">
              {activeTool === 'adjust' && (
                <div className="space-y-2">
                  <div className="flex justify-end px-6 mb-2">
                    <button 
                      onClick={() => setAdjustments(INITIAL_ADJUSTMENTS)}
                      className="text-[10px] font-black tracking-widest text-zinc-500 hover:text-white transition-colors uppercase"
                    >
                      Reset All
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Slider label="Brightness" value={adjustments.brightness} min={0} max={200} onChange={(v: any) => updateAdjustment('brightness', v)} onReset={() => updateAdjustment('brightness', 100)} />
                    <Slider label="Contrast" value={adjustments.contrast} min={0} max={200} onChange={(v: any) => updateAdjustment('contrast', v)} onReset={() => updateAdjustment('contrast', 100)} />
                    <Slider label="Saturation" value={adjustments.saturation} min={0} max={200} onChange={(v: any) => updateAdjustment('saturation', v)} onReset={() => updateAdjustment('saturation', 100)} />
                    <Slider label="Hue" value={adjustments.hue} min={-180} max={180} onChange={(v: any) => updateAdjustment('hue', v)} onReset={() => updateAdjustment('hue', 0)} />
                    <Slider label="Blur" value={adjustments.blur} min={0} max={20} step={0.1} onChange={(v: any) => updateAdjustment('blur', v)} onReset={() => updateAdjustment('blur', 0)} />
                    <Slider label="Sepia" value={adjustments.sepia} min={0} max={100} onChange={(v: any) => updateAdjustment('sepia', v)} onReset={() => updateAdjustment('sepia', 0)} />
                  </div>
                </div>
              )}

              {activeTool === 'filter' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="px-6 flex items-center justify-between">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Presets</span>
                    </div>
                    <div className="flex gap-5 px-6 overflow-x-auto pb-2 no-scrollbar">
                      {[
                        { name: 'Original', adj: INITIAL_ADJUSTMENTS },
                        { name: 'Vivid', adj: { ...INITIAL_ADJUSTMENTS, saturation: 150, contrast: 110 } },
                        { name: 'Noir', adj: { ...INITIAL_ADJUSTMENTS, grayscale: 100, contrast: 120 } },
                        { name: 'Vintage', adj: { ...INITIAL_ADJUSTMENTS, sepia: 60, brightness: 90, contrast: 90 } },
                        { name: 'Dramatic', adj: { ...INITIAL_ADJUSTMENTS, contrast: 160, brightness: 80 } },
                        { name: 'Cool', adj: { ...INITIAL_ADJUSTMENTS, hue: 180, saturation: 80, contrast: 110 } },
                        { name: 'Warm', adj: { ...INITIAL_ADJUSTMENTS, sepia: 30, saturation: 120, brightness: 105 } },
                      ].map((f) => (
                        <button
                          key={f.name}
                          onClick={() => setAdjustments(f.adj)}
                          className={cn(
                            "flex-shrink-0 w-24 space-y-3 group transition-all",
                            JSON.stringify(adjustments) === JSON.stringify(f.adj) ? "text-blue-500 scale-105" : "text-zinc-500"
                          )}
                        >
                          <div className={cn(
                            "aspect-square bg-zinc-800 rounded-2xl border-2 transition-all overflow-hidden shadow-lg",
                            JSON.stringify(adjustments) === JSON.stringify(f.adj) ? "border-blue-500" : "border-transparent group-hover:border-zinc-700"
                          )}>
                            <div 
                              className="w-full h-full bg-blue-500/10 flex items-center justify-center"
                              style={{ 
                                filter: `brightness(${f.adj.brightness}%) contrast(${f.adj.contrast}%) saturate(${f.adj.saturation}%) sepia(${f.adj.sepia}%) grayscale(${f.adj.grayscale}%)`
                              }}
                            >
                              <ImageIcon size={28} />
                            </div>
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em]">{f.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="px-6 flex items-center justify-between">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Color Grading</span>
                    </div>
                    <div className="flex gap-5 px-6 overflow-x-auto pb-4 no-scrollbar">
                      {[
                        { name: 'Cinematic', adj: { ...INITIAL_ADJUSTMENTS, saturation: 80, contrast: 130, hue: 10 } },
                        { name: 'Warm Retro', adj: { ...INITIAL_ADJUSTMENTS, hue: -20, saturation: 110, sepia: 20, contrast: 90 } },
                        { name: 'Cool Blue', adj: { ...INITIAL_ADJUSTMENTS, hue: 190, saturation: 120, contrast: 110 } },
                        { name: 'Teal/Orange', adj: { ...INITIAL_ADJUSTMENTS, hue: 160, saturation: 130, contrast: 120, brightness: 105 } },
                        { name: 'Faded', adj: { ...INITIAL_ADJUSTMENTS, contrast: 80, saturation: 70, brightness: 110 } },
                        { name: 'Cyber', adj: { ...INITIAL_ADJUSTMENTS, hue: 280, saturation: 150, contrast: 120 } },
                      ].map((f) => (
                        <button
                          key={f.name}
                          onClick={() => setAdjustments(f.adj)}
                          className={cn(
                            "flex-shrink-0 w-24 space-y-3 group transition-all",
                            JSON.stringify(adjustments) === JSON.stringify(f.adj) ? "text-purple-500 scale-105" : "text-zinc-500"
                          )}
                        >
                          <div className={cn(
                            "aspect-square bg-zinc-800 rounded-2xl border-2 transition-all overflow-hidden shadow-lg",
                            JSON.stringify(adjustments) === JSON.stringify(f.adj) ? "border-purple-500" : "border-transparent group-hover:border-zinc-700"
                          )}>
                            <div 
                              className="w-full h-full bg-purple-500/10 flex items-center justify-center"
                              style={{ 
                                filter: `brightness(${f.adj.brightness}%) contrast(${f.adj.contrast}%) saturate(${f.adj.saturation}%) hue-rotate(${f.adj.hue}deg) sepia(${f.adj.sepia}%)`
                              }}
                            >
                              <Palette size={28} />
                            </div>
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em]">{f.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTool === 'crop' && (
                <div className="flex gap-4 px-6 overflow-x-auto pb-4 no-scrollbar">
                  {[
                    { name: 'Free', ratio: null },
                    { name: '1:1', ratio: 1 },
                    { name: '4:5', ratio: 4/5 },
                    { name: '3:2', ratio: 3/2 },
                    { name: '16:9', ratio: 16/9 },
                    { name: '9:16', ratio: 9/16 },
                  ].map((r) => (
                    <button
                      key={r.name}
                      onClick={() => setCropRatio(r.ratio)}
                      className={cn(
                        "flex-shrink-0 px-6 py-3 rounded-2xl border-2 transition-all font-black text-[10px] tracking-widest uppercase",
                        cropRatio === r.ratio ? "border-blue-500 text-blue-500 bg-blue-500/10" : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
                      )}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}

              {activeTool === 'draw' && (
                <div className="px-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-3">
                      {['#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#4cd964', '#5ac8fa', '#007aff', '#5856d6', '#ff2d55'].map(color => (
                        <button
                          key={color}
                          onClick={() => setBrushColor(color)}
                          className={cn(
                            "w-8 h-8 rounded-full border-2 transition-all active:scale-75 shadow-lg",
                            brushColor === color ? "border-white scale-110" : "border-transparent"
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <button 
                      onClick={clearDrawings}
                      className="text-[10px] font-black tracking-widest text-zinc-500 hover:text-white transition-colors uppercase"
                    >
                      Clear All
                    </button>
                  </div>
                  <Slider label="Brush Size" value={brushSize} min={1} max={50} onChange={setBrushSize} onReset={() => setBrushSize(5)} />
                </div>
              )}

              {activeTool === 'ai' && (
                <div className="px-6 space-y-6 overflow-y-auto max-h-[60vh] no-scrollbar pb-10">
                  {/* Portrait Blur Section */}
                  <div className="p-5 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-500/10 rounded-xl">
                        <SlidersHorizontal size={20} className="text-green-400" />
                      </div>
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-widest text-white">Portrait Blur</h3>
                        <p className="text-[10px] text-zinc-500 font-medium">AI-powered depth effect</p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <Slider 
                        label="Blur Intensity" 
                        value={aiBlurIntensity} 
                        min={0} 
                        max={100} 
                        onChange={setAiBlurIntensity} 
                        onReset={() => setAiBlurIntensity(50)} 
                      />
                      
                      <button
                        onClick={() => {
                          let intensityDesc = "moderate";
                          if (aiBlurIntensity < 25) intensityDesc = "very subtle";
                          else if (aiBlurIntensity < 45) intensityDesc = "subtle";
                          else if (aiBlurIntensity < 70) intensityDesc = "moderate";
                          else if (aiBlurIntensity < 90) intensityDesc = "strong";
                          else intensityDesc = "extreme";
                          
                          handleAiEdit(`Apply a ${intensityDesc} professional portrait background blur to this image. Keep the main subject in perfectly sharp focus while creating a beautiful bokeh effect in the background. The blur level should be ${aiBlurIntensity}% intensity.`);
                        }}
                        disabled={isProcessing}
                        className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-2xl font-black text-[10px] tracking-widest uppercase transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-green-500/10"
                      >
                        {isProcessing ? "Processing..." : "Apply Portrait Blur"}
                      </button>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Other Magic Tools</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => handleAiEdit("Remove the background from this image and make it transparent. Return only the subject with a transparent background.")}
                        disabled={isProcessing}
                        className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                      >
                        <Eraser size={18} className="text-blue-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Remove BG</span>
                      </button>
                      <button
                        onClick={() => {
                          setAiPrompt("Replace the background with: ");
                          const textarea = document.querySelector('textarea');
                          if (textarea) textarea.focus();
                        }}
                        disabled={isProcessing}
                        className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                      >
                        <ImageIcon size={18} className="text-pink-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Change BG</span>
                      </button>
                      <button
                        onClick={() => handleAiEdit("Enhance this photo for professional quality. Improve lighting, colors, and sharpness.")}
                        disabled={isProcessing}
                        className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                      >
                        <Sparkles size={18} className="text-purple-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Enhance</span>
                      </button>
                      <button
                        onClick={() => handleAiEdit("Make this photo look like a professional studio portrait with high-end lighting and skin retouching.")}
                        disabled={isProcessing}
                        className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                      >
                        <Camera size={18} className="text-orange-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Studio</span>
                      </button>
                    </div>
                  </div>

                  {/* Custom Prompt */}
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Custom Magic Prompt</label>
                      <Sparkles size={14} className="text-purple-500 animate-pulse" />
                    </div>
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="e.g. 'Add a futuristic city background' or 'Make it look like an oil painting'"
                      className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none h-28 transition-all placeholder:text-zinc-600"
                    />
                  </div>
                  <button
                    onClick={() => handleAiEdit()}
                    disabled={!aiPrompt || isProcessing}
                    className="w-full py-4 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 rounded-2xl font-black text-sm shadow-xl shadow-purple-500/20 active:scale-[0.98] transition-all disabled:opacity-30 disabled:grayscale tracking-widest uppercase"
                  >
                    GENERATE MAGIC
                  </button>
                </div>
              )}
            </div>
            
            <div className="h-14 flex items-center justify-between px-8 border-t border-zinc-800/50">
              <button onClick={() => {
                clearDrawings();
                setCropRatio(null);
                setActiveTool('none');
              }} className="text-zinc-500 hover:text-white transition-colors p-2">
                <X size={24} />
              </button>
              <button 
                onClick={() => {
                  if (activeTool === 'draw') {
                    mergeAndSave();
                  } else if (activeTool === 'crop') {
                    applyCrop();
                  } else {
                    saveToHistory();
                    setActiveTool('none');
                  }
                }} 
                className="text-blue-500 hover:text-blue-400 transition-colors p-2"
              >
                <Check size={24} strokeWidth={3} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Toolbar */}
      <footer className="h-24 bg-zinc-900/90 backdrop-blur-3xl border-t border-zinc-800/50 flex items-center justify-around px-4 z-50 pb-safe">
        <IconButton 
          icon={SlidersHorizontal} 
          label="Adjust" 
          active={activeTool === 'adjust'} 
          onClick={() => setActiveTool('adjust')} 
          tooltip="Fine-tune adjustments"
          tooltipSide="top"
        />
        <IconButton 
          icon={Palette} 
          label="Filters" 
          active={activeTool === 'filter'} 
          onClick={() => setActiveTool('filter')} 
          tooltip="Apply filters & presets"
          tooltipSide="top"
        />
        <IconButton 
          icon={Crop} 
          label="Crop" 
          active={activeTool === 'crop'} 
          onClick={() => setActiveTool('crop')} 
          tooltip="Resize & crop"
          tooltipSide="top"
        />
        <IconButton 
          icon={Pencil} 
          label="Draw" 
          active={activeTool === 'draw'} 
          onClick={() => setActiveTool('draw')} 
          tooltip="Draw on photo"
          tooltipSide="top"
        />
        <IconButton 
          icon={Sparkles} 
          label="Magic" 
          active={activeTool === 'ai'} 
          onClick={() => setActiveTool('ai')} 
          className={cn(activeTool === 'ai' ? "text-purple-500" : "text-zinc-500")}
          tooltip="AI Magic tools"
          tooltipSide="top"
        />
      </footer>
    </div>
  );
}
