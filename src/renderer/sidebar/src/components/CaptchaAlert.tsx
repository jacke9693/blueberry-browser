import React from "react";
import { ShieldCheck, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useChat } from "../contexts/ChatContext";
import { cn } from "@common/lib/utils";
import { Button } from "@common/components/Button";

export const CaptchaAlert: React.FC = () => {
  const {
    captchaDetected,
    captchaInfo,
    solveCaptcha,
    captchaSolving,
    captchaResult,
  } = useChat();

  if (!captchaDetected) return null;

  return (
    <div
      className={cn(
        "mx-4 mb-4 p-4 rounded-xl border animate-fade-in",
        "bg-primary/5 border-primary/20 dark:bg-primary/10 dark:border-primary/30",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <ShieldCheck className="size-5 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-sm text-foreground">
              CAPTCHA Detected
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
              {captchaInfo?.type}
            </span>
          </div>

          {captchaInfo?.question && (
            <p className="text-xs text-muted-foreground mb-3">
              {captchaInfo.question}
            </p>
          )}

          {captchaResult ? (
            <div
              className={cn(
                "flex items-center gap-2 text-xs p-2 rounded-lg",
                captchaResult.includes("success") ||
                  captchaResult.includes("solved")
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              {captchaResult.includes("success") ||
              captchaResult.includes("solved") ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <AlertCircle className="size-4" />
              )}
              <span>{captchaResult}</span>
            </div>
          ) : (
            <Button
              onClick={solveCaptcha}
              disabled={captchaSolving}
              className="w-full"
              size="sm"
            >
              {captchaSolving ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Solving CAPTCHA...
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4 mr-2" />
                  Auto-Solve CAPTCHA
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
