"use client";

// The floating Ask Copper chat: a launcher, and a side panel with two separate
// conversations (tools on and tools off). Each answer streams in from the
// askCopper Server Action and is drawn by AnswerView.
import { ArrowUpIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AnswerView } from "@/components/copper/ask-copper-answer";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import type { Progress } from "@/lib/copper/assistant/progress";

const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
  "What's the difference between Copper Home and Copper Notes?",
];

type Turn =
  { role: "user"; content: string } | { role: "assistant"; progress: Progress };

type ChatKey = "on" | "off";

const toMessage = (turn: Turn): ChatMessage =>
  turn.role === "user"
    ? turn
    : { role: "assistant", content: turn.progress.reply };

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Record<ChatKey, Turn[]>>({
    on: [],
    off: [],
  });
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // The header link, a link to /#ask, or loading the site at /#ask opens the
  // panel. Clicking the link when the address already ends in #ask fires no
  // hashchange, so the click is heard too.
  useEffect(() => {
    const openIfAsk = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.("a");
      if (link?.getAttribute("href")?.endsWith("#ask")) setOpen(true);
    };
    const timer = setTimeout(openIfAsk, 0);
    window.addEventListener("hashchange", openIfAsk);
    document.addEventListener("click", onClick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", openIfAsk);
      document.removeEventListener("click", onClick);
    };
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Drop #ask from the address so the link works again next time.
    if (!next && window.location.hash === "#ask") {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }

  const key: ChatKey = useTools ? "on" : "off";
  const turns = chats[key];
  const last = turns.at(-1);
  const busy = last?.role === "assistant" && last.progress.status === "working";

  // Keep the newest step in view as the answer streams in.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [chats, open, useTools]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const chat = key;
    const messages = [
      ...chats[chat].map(toMessage),
      { role: "user" as const, content: text },
    ];
    const show = (progress: Progress) =>
      setChats((all) => ({
        ...all,
        [chat]: all[chat].map((turn, i, list) =>
          i === list.length - 1 ? { role: "assistant", progress } : turn,
        ),
      }));

    setInput("");
    setChats((all) => ({
      ...all,
      [chat]: [
        ...all[chat],
        { role: "user", content: text },
        {
          role: "assistant",
          progress: { steps: [], reply: "", status: "working" },
        },
      ],
    }));
    try {
      const { progress } = await askCopper({
        messages,
        useTools: chat === "on",
      });
      for await (const value of readLive(progress)) show(value);
    } catch {
      show({
        steps: [],
        reply: "Sorry, I couldn't put an answer together. Please try again.",
        status: "error",
      });
    }
  }

  return (
    <>
      <Button
        data-testid="ask-copper-launcher"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 h-11 gap-2 rounded-full px-4 shadow-lg"
      >
        <Image
          src="/assets/brand/copper-mascot.png"
          alt="Copper, the Copper State Labs mascot"
          width={24}
          height={24}
          className="size-6 rounded-full"
        />
        Ask Copper
      </Button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-testid="ask-copper"
          showCloseButton={false}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <div className="bg-foreground text-background dark:bg-card dark:text-card-foreground">
            <div className="flex items-center gap-3 px-4 py-3">
              <Image
                src="/assets/brand/copper-mascot.png"
                alt="Copper, the Copper State Labs mascot"
                width={40}
                height={40}
                className="bg-primary size-10 rounded-full"
              />
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-inherit">Ask Copper</SheetTitle>
                <SheetDescription className="text-xs text-inherit opacity-80">
                  Prices, totals and stock, checked with tools.
                </SheetDescription>
              </div>
              <SheetClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close">
                  <XIcon />
                </Button>
              </SheetClose>
            </div>
            {aiConfigured ? (
              <div className="bg-background/10 flex items-center gap-3 px-4 py-2 text-xs">
                <span className="font-medium">Use tools</span>
                <span className="opacity-80">
                  {useTools ? "Checks every answer" : "Model guesses alone"}
                </span>
                <Switch
                  aria-label="Use tools"
                  checked={useTools}
                  onCheckedChange={setUseTools}
                  className="ml-auto"
                />
              </div>
            ) : null}
          </div>

          {aiConfigured ? (
            <>
              <div
                ref={bodyRef}
                className="bg-secondary flex-1 space-y-4 overflow-y-auto p-4"
              >
                {turns.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Hi, I&apos;m Copper. Ask me about our products, prices and
                    what&apos;s in stock.
                  </p>
                ) : null}
                {turns.map((turn, i) =>
                  turn.role === "user" ? (
                    <p
                      key={i}
                      className="bg-primary text-primary-foreground ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm"
                    >
                      {turn.content}
                    </p>
                  ) : (
                    <AnswerView
                      key={i}
                      progress={turn.progress}
                      useTools={useTools}
                    />
                  ),
                )}
                {!busy ? (
                  <div className="flex flex-col items-start gap-2 pt-2">
                    {STARTERS.map((starter) => (
                      <Button
                        key={starter}
                        variant="outline"
                        onClick={() => send(starter)}
                        className="h-auto rounded-2xl px-3 py-1.5 text-left text-xs whitespace-normal"
                      >
                        {starter}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>

              <form
                className="bg-background flex items-center gap-2 border-t p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(input);
                }}
              >
                <Input
                  aria-label="Your question"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask about a price or stock…"
                  className="h-9 flex-1 rounded-full px-3"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={busy || !input.trim()}
                  className="size-9 rounded-full"
                >
                  <ArrowUpIcon />
                </Button>
              </form>
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto px-4">
              <SetupRequired service="ai" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
