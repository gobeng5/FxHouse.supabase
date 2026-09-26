import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Smartphone, CheckCircle2, Share, MoreVertical } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Check if iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  if (isInstalled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <CardTitle className="text-2xl">App Installed!</CardTitle>
            <CardDescription>
              SMC Trading Signals is now installed on your device
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full" onClick={() => navigate("/")}>
              Open App
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-20 h-20 bg-primary/20 rounded-2xl flex items-center justify-center">
            <Smartphone className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-2xl">Install SMC Signals</CardTitle>
          <CardDescription>
            Get instant access to trading signals right from your home screen
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary">1</span>
              </div>
              <div>
                <p className="font-medium">Works Offline</p>
                <p className="text-sm text-muted-foreground">
                  Access your signals even without internet
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary">2</span>
              </div>
              <div>
                <p className="font-medium">Fast & Native Feel</p>
                <p className="text-sm text-muted-foreground">
                  Loads instantly like a native app
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary">3</span>
              </div>
              <div>
                <p className="font-medium">Always Updated</p>
                <p className="text-sm text-muted-foreground">
                  Automatically syncs with the latest version
                </p>
              </div>
            </div>
          </div>

          {isIOS ? (
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <p className="font-medium text-center">To install on iPhone/iPad:</p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Share className="w-4 h-4" />
                  <span>1. Tap the Share button in Safari</span>
                </div>
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  <span>2. Scroll down and tap "Add to Home Screen"</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>3. Tap "Add" to confirm</span>
                </div>
              </div>
            </div>
          ) : deferredPrompt ? (
            <Button className="w-full" size="lg" onClick={handleInstall}>
              <Download className="w-4 h-4 mr-2" />
              Install App
            </Button>
          ) : (
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <p className="font-medium text-center">To install on Android:</p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <MoreVertical className="w-4 h-4" />
                  <span>1. Tap the menu (⋮) in Chrome</span>
                </div>
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  <span>2. Tap "Install app" or "Add to Home screen"</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>3. Tap "Install" to confirm</span>
                </div>
              </div>
            </div>
          )}

          <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>
            Continue in browser
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Install;
