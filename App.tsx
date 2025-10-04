import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ProcessingState, FrameData } from './types';
import { removeWatermark } from './services/geminiService';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';


declare const JSZip: any;

// --- Helper Components ---

const Loader: React.FC = () => (
    <div className="flex justify-center items-center h-full">
        <svg className="animate-spin h-8 w-8 text-[#FF96AC]" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2"></circle>
            <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeLinecap="round" strokeWidth="2"></path>
        </svg>
    </div>
);


interface FrameCardProps {
  frame: FrameData;
  isProcessing: boolean;
}

const FrameCard: React.FC<FrameCardProps> = ({ frame, isProcessing }) => (
  <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden animate-fade-in">
    <div className="p-3">
      <p className="text-center text-sm font-normal text-gray-300 mb-2">Frame {frame.id + 1}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <h3 className="text-xs text-center text-gray-400 font-light mb-1">Original</h3>
          <img src={frame.original} alt={`Original frame ${frame.id + 1}`} className="w-full h-auto rounded" />
        </div>
        <div>
          <h3 className="text-xs text-center text-gray-400 font-light mb-1">Processed</h3>
          <div className="w-full aspect-video bg-black/20 rounded flex items-center justify-center border border-white/10">
            {frame.processed ? (
              <img src={frame.processed} alt={`Processed frame ${frame.id + 1}`} className="w-full h-auto rounded" />
            ) : isProcessing ? (
              <Loader />
            ) : (
               <div className="text-gray-500 text-sm flex flex-col items-center justify-center h-full font-light">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mb-1 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l-1-1m6-3l-2-2" /></svg>
                    <span>Pending</span>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
);

// --- Main App Component ---

const App: React.FC = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [maxFrames, setMaxFrames] = useState<number>(10);
  const [status, setStatus] = useState<ProcessingState>(ProcessingState.IDLE);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [processedVideoUrl, setProcessedVideoUrl] = useState<string | null>(null);
  const [assembledVideoFilename, setAssembledVideoFilename] = useState<string>('video.mp4');
  const [encodingProgress, setEncodingProgress] = useState<number>(0);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegLoaded = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoSrc = useMemo(() => videoFile ? URL.createObjectURL(videoFile) : null, [videoFile]);

  useEffect(() => {
    // This effect handles the cleanup of blob URLs to prevent memory leaks.
    // It runs when the component unmounts or before the effect runs again.
    return () => {
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
      }
    };
  }, [videoSrc]);

  const handleReset = () => {
    setVideoFile(null);
    setFrames([]);
    setMaxFrames(10);
    setStatus(ProcessingState.IDLE);
    setProgressMessage('');
    setError(null);
    setProcessedVideoUrl(null);
    setAssembledVideoFilename('video.mp4');
    setEncodingProgress(0);

    // Clear the file input so the user can re-select the same file
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    
    // Always reset the processing state when a new file is selected.
    setFrames([]);
    setStatus(ProcessingState.IDLE);
    setProgressMessage('');
    setProcessedVideoUrl(null);
    setError(null);

    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
    } else {
      setVideoFile(null); // Clear video file if invalid selection
      if (file) { // Show error only if a file was selected but was invalid
        setError('Please select a valid video file.');
      }
    }
  };

  const extractFrames = useCallback(async (file: File, frameCount: number): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const videoUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.crossOrigin = "anonymous";
      video.muted = true;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const extractedFrames: string[] = [];
      
      if (!context) {
        return reject(new Error('Could not get canvas context.'));
      }

      video.addEventListener('loadedmetadata', () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const duration = video.duration;
        const interval = duration > 0 ? duration / frameCount : 0;
        let currentTime = 0;
        let capturedFrames = 0;

        const seekNext = () => {
            if (capturedFrames >= frameCount || interval === 0) {
                URL.revokeObjectURL(videoUrl);
                resolve(extractedFrames);
                return;
            }
            video.currentTime = currentTime;
            currentTime += interval;
        };

        video.addEventListener('seeked', () => {
            if (capturedFrames < frameCount) {
              context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
              extractedFrames.push(canvas.toDataURL('image/jpeg', 0.9));
              capturedFrames++;
            }
            setTimeout(seekNext, 50); 
        });
        
        seekNext();
      });

      video.addEventListener('error', (e) => {
        URL.revokeObjectURL(videoUrl);
        reject(new Error('Error loading video file. It may be corrupt or in an unsupported format.'));
      });
      
      video.src = videoUrl;
      video.play().catch(e => {
        console.warn("Video play failed, proceeding with seeking.", e);
      });
    });
  }, []);

  const handleExtractFrames = async () => {
    if (!videoFile) return;
    setStatus(ProcessingState.EXTRACTING);
    setProgressMessage(`Extracting ${maxFrames} frames...`);
    setError(null);
    setFrames([]);
    try {
      const originalFrameUrls = await extractFrames(videoFile, maxFrames);
      const initialFramesData: FrameData[] = originalFrameUrls.map((url, index) => ({
        id: index,
        original: url,
        processed: null,
      }));
      setFrames(initialFramesData);
      setStatus(ProcessingState.EXTRACTED);
      setProgressMessage(`Successfully extracted ${originalFrameUrls.length} frames.`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unknown error occurred during frame extraction.');
      setStatus(ProcessingState.ERROR);
    }
  }

  const handleRemoveWatermarks = async () => {
      setStatus(ProcessingState.PROCESSING);
      setError(null);
      try {
        for (let i = 0; i < frames.length; i++) {
            setProgressMessage(`Processing frame ${i + 1} of ${frames.length}...`);
            const processedUrl = await removeWatermark(frames[i].original);
            setFrames(prevFrames => 
            prevFrames.map(frame => 
                frame.id === i ? { ...frame, processed: processedUrl } : frame
            )
            );
            if (i < frames.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        setStatus(ProcessingState.DONE);
        setProgressMessage('All frames processed!');
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'An unknown error occurred during AI processing.');
        setStatus(ProcessingState.ERROR);
      }
  };
  
  const handleAssembleVideo = async (source: 'original' | 'processed') => {
    let framesToAssemble: string[];

    if (source === 'processed') {
        const processedFrames = frames.filter(f => f.processed).map(f => f.processed as string);
        if (processedFrames.length !== frames.length) {
          setError("Not all frames have been processed yet.");
          return;
        }
        framesToAssemble = processedFrames;
        setAssembledVideoFilename(`processed_${videoFile?.name || 'video.mp4'}`);
    } else {
        framesToAssemble = frames.map(f => f.original);
        setAssembledVideoFilename(`assembled_original_${videoFile?.name || 'video.mp4'}`);
    }

    if (framesToAssemble.length === 0) {
        setError("No frames available to assemble.");
        return;
    }
    
    setStatus(ProcessingState.ASSEMBLING);
    setEncodingProgress(0);
    setError(null);
    setProgressMessage("Starting video assembly...");

    try {
      if (!ffmpegRef.current) {
        ffmpegRef.current = new FFmpeg();
      }
      const ffmpeg = ffmpegRef.current;
      
      ffmpeg.on('log', ({ message }) => {
        console.log(message);
      });

      ffmpeg.on('progress', ({ progress }) => {
        setEncodingProgress(progress);
        if (progress < 1) {
          setProgressMessage(`Encoding video... ${Math.round(progress * 100)}%`);
        }
      });
      
      setProgressMessage("Loading video engine...");
      if (!ffmpegLoaded.current) {
        // Use a compatible, multi-threaded version of FFmpeg core for performance and stability.
        const baseURL = "https://aistudiocdn.com/@ffmpeg/core-mt@0.12.6/dist/esm";
        const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript");
        const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm");
        const workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript");
        
        await ffmpeg.load({ coreURL, wasmURL, workerURL });
        
        ffmpegLoaded.current = true;
      }
      
      setProgressMessage("Writing frames to memory...");
      for (let i = 0; i < framesToAssemble.length; i++) {
        const frameData = await fetchFile(framesToAssemble[i]);
        await ffmpeg.writeFile(`frame-${String(i).padStart(3, '0')}.jpg`, frameData);
      }
      
      setProgressMessage("Encoding video...");
      await ffmpeg.exec(['-framerate', '24', '-i', 'frame-%03d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'output.mp4']);
      
      setProgressMessage("Finishing up...");
      const data = await ffmpeg.readFile('output.mp4');
      const url = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
      setProcessedVideoUrl(url);
      setProgressMessage("Video assembly complete!");
      setStatus(ProcessingState.IDLE);
      setEncodingProgress(0);

    } catch (err: any) {
      console.error("Error assembling video:", err);
      setError("Failed to assemble video. Check the console for details.");
      setStatus(ProcessingState.ERROR);
      setEncodingProgress(0);
    }
  };

  const handleDownloadZip = async () => {
    if (frames.length === 0) return;
    
    setProgressMessage('Preparing zip file...');
    const zip = new JSZip();
    
    frames.forEach(frame => {
        const base64Data = frame.original.split(',')[1];
        zip.file(`frame_${String(frame.id + 1).padStart(3, '0')}.jpg`, base64Data, { base64: true });
    });
    
    try {
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `extracted_frames_${videoFile?.name || 'video'}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        setProgressMessage('Zip file download started.');
    } catch (err) {
        console.error("Error creating zip file", err);
        setError("Could not create zip file.");
    }
  };
  
  const handleDownloadProcessedZip = async () => {
    const processedFrames = frames.filter(f => f.processed);
    if (processedFrames.length === 0) {
      setError("No processed frames available to download.");
      return;
    }

    setProgressMessage('Preparing zip file of processed frames...');
    const zip = new JSZip();

    processedFrames.forEach(frame => {
      if (frame.processed) {
        const base64Data = frame.processed.split(',')[1];
        zip.file(`processed_frame_${String(frame.id + 1).padStart(3, '0')}.jpg`, base64Data, { base64: true });
      }
    });

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `processed_frames_${videoFile?.name || 'video'}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      setProgressMessage('Processed frames zip download started.');
    } catch (err) {
      console.error("Error creating processed zip file", err);
      setError("Could not create processed zip file.");
    }
  };

  const isProcessing = status === ProcessingState.EXTRACTING || status === ProcessingState.PROCESSING || status === ProcessingState.ASSEMBLING;

  return (
    <div className="min-h-screen bg-black text-white font-sans p-4 sm:p-6 lg:p-8">
      <style>{`
        :root {
          --slider-track-bg: rgba(255, 255, 255, 0.1);
          --slider-thumb-bg: #FF96AC;
          --slider-thumb-border: rgba(0, 0, 0, 0.2);
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
        }
        .animate-fade-in {
          animation: fadeIn 0.5s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ios-slider {
            -webkit-appearance: none;
            width: 100%;
            height: 2px;
            background: var(--slider-track-bg);
            outline: none;
            border-radius: 2px;
            transition: opacity .2s;
        }
        .ios-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 24px;
            height: 24px;
            background: var(--slider-thumb-bg);
            cursor: pointer;
            border-radius: 50%;
            border: 4px solid #000;
        }
        .ios-slider::-moz-range-thumb {
            width: 24px;
            height: 24px;
            background: var(--slider-thumb-bg);
            cursor: pointer;
            border-radius: 50%;
            border: 4px solid #000;
        }
      `}</style>
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-10 relative">
          <h1 className="text-4xl sm:text-5xl font-light mb-2 text-[#FF96AC]">
            Sora Watermark Remover｜ZHO
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto font-light">
            Using AI, this tool removes watermarks by processing your video frame by frame.
          </p>
           {videoFile && (
            <button
              onClick={handleReset}
              className="absolute top-0 right-0 bg-white/10 hover:bg-white/20 text-[#FF96AC] font-normal py-2 px-4 rounded-lg transition-colors text-sm"
            >
              Start Over
            </button>
          )}
        </header>

        <main>
          <div className="bg-white/5 backdrop-blur-lg border border-white/10 p-6 rounded-xl shadow-lg mb-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <label htmlFor="video-upload" className="block text-lg font-normal text-gray-200 mb-3">Step 1: Choose a Video File</label>
                 <label className={`w-full cursor-pointer text-center font-normal py-3 px-4 rounded-lg transition-colors ${isProcessing ? 'bg-gray-700/50 text-gray-500' : 'bg-white/10 hover:bg-white/20 text-gray-300'}`}>
                    {videoFile ? videoFile.name : 'Select a video...'}
                    <input
                      id="video-upload"
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      onChange={handleFileChange}
                      disabled={isProcessing}
                      className="hidden"
                    />
                </label>
                 {videoSrc && !processedVideoUrl && (
                  <div className="mt-4 border border-white/10 rounded-lg overflow-hidden">
                      <video key={videoSrc} controls src={videoSrc} className="w-full max-h-48"></video>
                  </div>
                 )}
              </div>
              <div className="flex flex-col items-center justify-center space-y-3">
                <label htmlFor="max-frames" className="block text-lg font-normal text-gray-200">Step 2: Configure Frames</label>
                <div className="flex items-center gap-4 w-full max-w-xs">
                    <input
                        id="max-frames"
                        type="range"
                        min="2"
                        max="300"
                        value={maxFrames}
                        onChange={(e) => setMaxFrames(Number(e.target.value))}
                        disabled={isProcessing || frames.length > 0}
                        className="ios-slider disabled:opacity-50"
                    />
                    <span className="font-light text-[#FF96AC] text-xl w-12 text-center">{maxFrames}</span>
                </div>
                <p className="text-xs text-gray-500 pt-1 font-light">More frames result in a longer processing time.</p>
              </div>
            </div>
             <div className="text-center mt-6 pt-6 border-t border-white/10">
                 <button 
                  onClick={handleExtractFrames}
                  disabled={!videoFile || isProcessing || frames.length > 0}
                  className="bg-[#FF96AC] hover:bg-opacity-80 text-black font-normal py-3 px-8 rounded-lg text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === ProcessingState.EXTRACTING ? 'Extracting...' : 'Step 3: Extract Frames'}
                </button>
            </div>
          </div>
          
          {status === ProcessingState.EXTRACTED && (
             <div className="text-center my-6 p-6 bg-white/5 backdrop-blur-lg border border-white/10 rounded-xl animate-fade-in">
                 <h2 className="text-xl font-normal mb-4 text-gray-200">Next Steps</h2>
                 <div className="flex flex-wrap items-center justify-center gap-4">
                    <button 
                        onClick={handleDownloadZip}
                        disabled={isProcessing}
                        className="bg-transparent text-[#FF96AC] font-normal py-2 px-6 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                        Download Originals (.zip)
                    </button>
                    <button
                        onClick={() => handleAssembleVideo('original')}
                        disabled={isProcessing}
                        className="bg-transparent text-[#FF96AC] font-normal py-2 px-6 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                        Assemble Original Video
                    </button>
                    <button
                        onClick={handleRemoveWatermarks}
                        disabled={isProcessing}
                        className="bg-[#FF96AC] hover:bg-opacity-80 text-black font-normal py-3 px-8 rounded-lg text-lg transition-all disabled:opacity-50"
                    >
                        Step 4: Remove Watermarks
                    </button>
                </div>
            </div>
          )}

          {status === ProcessingState.DONE && !processedVideoUrl && (
              <div className="text-center my-6 p-6 bg-white/5 backdrop-blur-lg border border-white/10 rounded-xl animate-fade-in">
                <h2 className="text-xl font-normal mb-4 text-[#FF96AC]">Processing Complete</h2>
                <p className="text-gray-300 mb-4 font-light">All frames have been processed. You can now assemble the final video or download the frames.</p>
                <div className="flex flex-wrap items-center justify-center gap-4">
                    <button
                        onClick={handleDownloadProcessedZip}
                        disabled={isProcessing}
                        className="bg-transparent text-[#FF96AC] font-normal py-2 px-6 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                        Download Processed (.zip)
                    </button>
                    <button
                        onClick={() => handleAssembleVideo('processed')}
                        disabled={isProcessing}
                        className="bg-[#FF96AC] hover:bg-opacity-80 text-black font-normal py-3 px-8 rounded-lg text-lg transition-all disabled:opacity-50"
                    >
                        Step 5: Assemble Processed Video
                    </button>
                </div>
              </div>
          )}
          
          {(isProcessing || error) && (
            <div className="text-center my-6 font-light">
              <p className="text-gray-300">{progressMessage}</p>
              {status === ProcessingState.PROCESSING && (
                <div className="w-full bg-white/10 rounded-full h-1 mt-2 max-w-md mx-auto">
                  <div className="bg-[#FF96AC] h-1 rounded-full" style={{ width: `${frames.filter(f => f.processed).length / frames.length * 100}%` }}></div>
                </div>
              )}
               {status === ProcessingState.ASSEMBLING && (
                <div className="w-full bg-white/10 rounded-full h-1 mt-2 max-w-md mx-auto">
                  <div className="bg-[#FF96AC] h-1 rounded-full transition-all duration-150" style={{ width: `${encodingProgress * 100}%` }}></div>
                </div>
              )}
              {error && <p className="text-red-400 mt-2">{error}</p>}
            </div>
          )}

          {processedVideoUrl && (
            <div className="my-8 animate-fade-in">
                <h2 className="text-2xl font-normal text-center mb-4 text-[#FF96AC]">Your Video is Ready</h2>
                <div className="max-w-2xl mx-auto bg-white/5 border border-white/10 p-4 rounded-lg">
                    <video key={processedVideoUrl} controls src={processedVideoUrl} className="w-full rounded-lg"></video>
                    <div className="text-center mt-4">
                        <a
                            href={processedVideoUrl}
                            download={assembledVideoFilename}
                            className="bg-[#FF96AC] hover:bg-opacity-80 text-black font-normal py-2 px-6 rounded-lg transition-colors inline-block"
                        >
                            Download Video
                        </a>
                    </div>
                </div>
            </div>
          )}

          {frames.length > 0 && !processedVideoUrl && (
            <div>
                <h2 className="text-2xl font-normal text-center mb-6">Extracted Frames</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {frames.map(frame => <FrameCard key={frame.id} frame={frame} isProcessing={status === ProcessingState.PROCESSING} />)}
                </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;