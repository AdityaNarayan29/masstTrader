"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import ReactMarkdown from "react-markdown";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";

const QUICK_TOPICS = [
  "What is RSI and how to use it",
  "MACD crossover strategy explained",
  "Risk management basics",
  "How to read candlestick patterns",
  "Understanding support and resistance",
  "What is a stop loss and why it matters",
  "Trend vs range trading",
  "Position sizing for beginners",
];

const INSTRUMENTS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "XAUUSD",
  "Volatility 75 Index",
  "Volatility 100 Index",
  "Crash 1000",
  "Boom 1000",
  "BTCUSD",
  "ETHUSD",
];

export default function TutorPage() {
  const [level, setLevel] = useState("intermediate");
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([
    "EURUSD",
  ]);
  const [customTopic, setCustomTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [lesson, setLesson] = useState("");
  const [error, setError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: string; content: string }>
  >([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const toggleInstrument = (inst: string) => {
    setSelectedInstruments((prev) =>
      prev.includes(inst) ? prev.filter((i) => i !== inst) : [...prev, inst]
    );
  };

  const handleLearn = async (topicOverride?: string) => {
    const t = topicOverride || customTopic;
    if (!t) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.tutor.lesson(t, level, selectedInstruments);
      setLesson(res.lesson);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to get lesson");
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const question = chatInput;
    setChatInput("");
    setChatSending(true);
    setChatHistory((prev) => [...prev, { role: "user", content: question }]);
    try {
      const res = await api.tutor.lesson(question, level, selectedInstruments);
      setChatHistory((prev) => [...prev, { role: "ai", content: res.lesson }]);
    } catch {
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", content: "Sorry, something went wrong. Try again." },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          AI Trading Tutor
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Personalized lessons based on your level and the instruments you trade
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="py-3 text-destructive text-sm">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Profile + Topics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Your Profile</CardTitle>
            <CardDescription>Set your trading experience</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="level-select">Level</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger id="level-select" className="w-full">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Instruments You Trade</Label>
              <div className="flex flex-wrap gap-1.5">
                {INSTRUMENTS.map((inst) => (
                  <Badge
                    key={inst}
                    variant={
                      selectedInstruments.includes(inst)
                        ? "default"
                        : "outline"
                    }
                    className="cursor-pointer select-none transition-colors"
                    onClick={() => toggleInstrument(inst)}
                  >
                    {inst}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Topics + Custom Input */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Quick Topics</CardTitle>
            <CardDescription>
              Pick a topic or type your own below
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_TOPICS.map((t) => (
                <Card
                  key={t}
                  className="cursor-pointer py-0 transition-colors hover:bg-accent hover:border-primary/30"
                  onClick={() => {
                    if (!loading) handleLearn(t);
                  }}
                >
                  <CardContent className="p-3">
                    <p className="text-sm leading-snug">{t}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Separator />

            <div className="flex gap-2">
              <Input
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                placeholder="Or type your own topic..."
                onKeyDown={(e) => e.key === "Enter" && handleLearn()}
              />
              <Button
                onClick={() => handleLearn()}
                disabled={loading || !customTopic.trim()}
              >
                {loading ? "Loading..." : "Teach Me"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lesson + Chat in Tabs */}
      <Tabs defaultValue="lesson" className="w-full">
        <TabsList>
          <TabsTrigger value="lesson">Lesson</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
        </TabsList>

        {/* Lesson Tab */}
        <TabsContent value="lesson">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Lesson</CardTitle>
              <CardDescription>
                {lesson
                  ? "Your AI-generated lesson is below"
                  : "Select a topic above to generate a lesson"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Generating your lesson...</p>
                </div>
              ) : lesson ? (
                <div className="prose prose-sm prose-lesson max-w-none text-sm">
                  <ReactMarkdown>{lesson}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No lesson yet. Choose a quick topic or enter a custom one to
                  get started.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Ask Follow-up Questions</CardTitle>
              <CardDescription>
                Chat with the AI tutor about trading concepts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Message List */}
              <div className="max-h-96 overflow-y-auto space-y-3 min-h-[200px]">
                {chatHistory.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-12">
                    No messages yet. Ask a question below to start the
                    conversation.
                  </p>
                )}
                {chatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <Card
                      className={`max-w-[80%] py-0 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <CardContent className="p-3">
                        <p className="text-xs font-medium mb-1 opacity-70">
                          {msg.role === "user" ? "You" : "AI Tutor"}
                        </p>
                        <div
                          className={`prose prose-sm max-w-none text-sm ${
                            msg.role === "user"
                              ? "text-primary-foreground [--tw-prose-body:var(--primary-foreground)] [--tw-prose-headings:var(--primary-foreground)] [--tw-prose-bold:var(--primary-foreground)]"
                              : "prose-lesson"
                          }`}
                        >
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <Separator />

              {/* Chat Input */}
              {chatSending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI Tutor is thinking...
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask anything about trading..."
                  onKeyDown={(e) => e.key === "Enter" && handleChat()}
                  disabled={chatSending}
                />
                <Button
                  variant="secondary"
                  onClick={handleChat}
                  disabled={!chatInput.trim() || chatSending}
                >
                  {chatSending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
