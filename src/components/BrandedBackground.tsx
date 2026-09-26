import { useEffect, useState } from 'react';
import appIcon from '@/assets/app-icon.png';

interface BrandedBackgroundProps {
  variant?: 'default' | 'subtle' | 'prominent';
  animated?: boolean;
}

export const BrandedBackground = ({ 
  variant = 'default', 
  animated = true 
}: BrandedBackgroundProps) => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!animated) return;

    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 20;
      const y = (e.clientY / window.innerHeight - 0.5) * 20;
      setMousePosition({ x, y });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [animated]);

  const opacityMap = {
    subtle: 'opacity-[0.015]',
    default: 'opacity-[0.025]',
    prominent: 'opacity-[0.04]',
  };

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
      
      {/* Top-right large watermark */}
      <div 
        className={`absolute -top-20 -right-20 w-[500px] h-[500px] ${opacityMap[variant]} transition-transform duration-[2000ms] ease-out`}
        style={{
          transform: animated 
            ? `translate(${mousePosition.x * 0.5}px, ${mousePosition.y * 0.5}px) rotate(15deg)` 
            : 'rotate(15deg)',
        }}
      >
        <img 
          src={appIcon} 
          alt="" 
          className="w-full h-full object-contain filter grayscale"
          aria-hidden="true"
        />
      </div>

      {/* Bottom-left medium watermark */}
      <div 
        className={`absolute -bottom-16 -left-16 w-[350px] h-[350px] ${opacityMap[variant]} transition-transform duration-[2500ms] ease-out`}
        style={{
          transform: animated 
            ? `translate(${-mousePosition.x * 0.3}px, ${-mousePosition.y * 0.3}px) rotate(-20deg)` 
            : 'rotate(-20deg)',
        }}
      >
        <img 
          src={appIcon} 
          alt="" 
          className="w-full h-full object-contain filter grayscale"
          aria-hidden="true"
        />
      </div>

      {/* Center-right small watermark */}
      <div 
        className={`absolute top-1/2 -right-8 w-[200px] h-[200px] ${opacityMap[variant]} transition-transform duration-[3000ms] ease-out`}
        style={{
          transform: animated 
            ? `translate(${mousePosition.x * 0.2}px, ${mousePosition.y * 0.2}px) rotate(45deg)` 
            : 'rotate(45deg)',
        }}
      >
        <img 
          src={appIcon} 
          alt="" 
          className="w-full h-full object-contain filter grayscale"
          aria-hidden="true"
        />
      </div>

      {/* Top-left small watermark */}
      <div 
        className={`absolute top-32 -left-8 w-[180px] h-[180px] ${opacityMap[variant]} transition-transform duration-[2800ms] ease-out`}
        style={{
          transform: animated 
            ? `translate(${-mousePosition.x * 0.4}px, ${-mousePosition.y * 0.4}px) rotate(-10deg)` 
            : 'rotate(-10deg)',
        }}
      >
        <img 
          src={appIcon} 
          alt="" 
          className="w-full h-full object-contain filter grayscale"
          aria-hidden="true"
        />
      </div>

      {/* Center floating watermark */}
      <div 
        className={`absolute top-1/3 left-1/4 w-[250px] h-[250px] ${opacityMap[variant]} transition-transform duration-[3500ms] ease-out`}
        style={{
          transform: animated 
            ? `translate(${mousePosition.x * 0.15}px, ${mousePosition.y * 0.15}px) rotate(30deg)` 
            : 'rotate(30deg)',
        }}
      >
        <img 
          src={appIcon} 
          alt="" 
          className="w-full h-full object-contain filter grayscale"
          aria-hidden="true"
        />
      </div>

      {/* Animated glow orbs */}
      <div className="absolute top-1/4 right-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 left-1/3 w-48 h-48 bg-accent/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="absolute top-2/3 right-1/3 w-32 h-32 bg-primary/3 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '2s' }} />
    </div>
  );
};