export interface GroupEmojiOption {
  value: string;
  label: string;
  shortcode: string;
  aliases: readonly string[];
}

export const GROUP_EMOJI_OPTIONS: readonly GroupEmojiOption[] = [
  { value: "📥", label: "Inbox", shortcode: "inbox_tray", aliases: ["inbox"] },
  {
    value: "🚧",
    label: "In progress",
    shortcode: "construction",
    aliases: ["wip", "working"],
  },
  {
    value: "🔥",
    label: "Urgent",
    shortcode: "fire",
    aliases: ["hot", "priority"],
  },
  {
    value: "🎯",
    label: "Goal",
    shortcode: "dart",
    aliases: ["target", "objective"],
  },
  {
    value: "💡",
    label: "Idea",
    shortcode: "bulb",
    aliases: ["lightbulb", "insight"],
  },
  {
    value: "✅",
    label: "Done",
    shortcode: "white_check_mark",
    aliases: ["complete", "completed", "check"],
  },
  {
    value: "🧭",
    label: "Planning",
    shortcode: "compass",
    aliases: ["plan", "direction"],
  },
  {
    value: "🛠️",
    label: "Tools",
    shortcode: "hammer_and_wrench",
    aliases: ["tooling", "maintenance"],
  },
  {
    value: "🔍",
    label: "Research",
    shortcode: "mag",
    aliases: ["search", "investigate"],
  },
  {
    value: "🧪",
    label: "Experiment",
    shortcode: "test_tube",
    aliases: ["test", "testing", "science"],
  },
  {
    value: "📌",
    label: "Pinned",
    shortcode: "pushpin",
    aliases: ["pin", "important"],
  },
  {
    value: "📝",
    label: "Notes",
    shortcode: "memo",
    aliases: ["write", "writing"],
  },
  {
    value: "📚",
    label: "Documentation",
    shortcode: "books",
    aliases: ["docs", "read"],
  },
  {
    value: "🗂️",
    label: "Organize",
    shortcode: "card_index_dividers",
    aliases: ["filing", "sort"],
  },
  {
    value: "💬",
    label: "Discussion",
    shortcode: "speech_balloon",
    aliases: ["chat", "conversation"],
  },
  {
    value: "👀",
    label: "Review",
    shortcode: "eyes",
    aliases: ["look", "inspect"],
  },
  {
    value: "🙋",
    label: "Needs input",
    shortcode: "raising_hand",
    aliases: ["question", "help", "blocked"],
  },
  {
    value: "🤝",
    label: "Collaboration",
    shortcode: "handshake",
    aliases: ["partner", "team"],
  },
  {
    value: "🚀",
    label: "Launch",
    shortcode: "rocket",
    aliases: ["ship", "deploy", "release"],
  },
  {
    value: "⚡",
    label: "Fast",
    shortcode: "zap",
    aliases: ["quick", "performance"],
  },
  {
    value: "🐛",
    label: "Bug",
    shortcode: "bug",
    aliases: ["fix", "issue", "defect"],
  },
  {
    value: "🎨",
    label: "Design",
    shortcode: "art",
    aliases: ["ui", "ux", "creative"],
  },
  {
    value: "📊",
    label: "Metrics",
    shortcode: "bar_chart",
    aliases: ["analytics", "data"],
  },
  {
    value: "🔒",
    label: "Security",
    shortcode: "lock",
    aliases: ["private", "secure"],
  },
  {
    value: "🌱",
    label: "Growth",
    shortcode: "seedling",
    aliases: ["new", "learning"],
  },
  {
    value: "🏁",
    label: "Finish",
    shortcode: "checkered_flag",
    aliases: ["flag", "milestone"],
  },
  {
    value: "😀",
    label: "Happy",
    shortcode: "grinning",
    aliases: ["smile", "glad"],
  },
  { value: "😂", label: "Joy", shortcode: "joy", aliases: ["laugh", "funny"] },
  {
    value: "🤔",
    label: "Thinking",
    shortcode: "thinking_face",
    aliases: ["consider", "hmm"],
  },
  {
    value: "🥳",
    label: "Celebrate",
    shortcode: "partying_face",
    aliases: ["party", "celebration"],
  },
  {
    value: "❤️",
    label: "Love",
    shortcode: "heart",
    aliases: ["favorite", "like"],
  },
  {
    value: "👍",
    label: "Approved",
    shortcode: "thumbsup",
    aliases: ["like", "yes", "+1"],
  },
  {
    value: "👎",
    label: "Rejected",
    shortcode: "thumbsdown",
    aliases: ["no", "-1"],
  },
  {
    value: "👏",
    label: "Applause",
    shortcode: "clap",
    aliases: ["congrats", "great"],
  },
  {
    value: "🙏",
    label: "Thanks",
    shortcode: "pray",
    aliases: ["please", "gratitude"],
  },
  {
    value: "🤖",
    label: "Automation",
    shortcode: "robot_face",
    aliases: ["robot", "bot", "ai"],
  },
  {
    value: "💻",
    label: "Development",
    shortcode: "computer",
    aliases: ["code", "coding", "laptop"],
  },
  {
    value: "⚙️",
    label: "Settings",
    shortcode: "gear",
    aliases: ["config", "configuration"],
  },
  {
    value: "🔧",
    label: "Fix",
    shortcode: "wrench",
    aliases: ["repair", "maintenance"],
  },
  {
    value: "🔨",
    label: "Build",
    shortcode: "hammer",
    aliases: ["construct", "compile"],
  },
  {
    value: "📦",
    label: "Package",
    shortcode: "package",
    aliases: ["bundle", "release"],
  },
  {
    value: "🧵",
    label: "Thread",
    shortcode: "thread",
    aliases: ["conversation", "session"],
  },
  {
    value: "🔗",
    label: "Link",
    shortcode: "link",
    aliases: ["url", "reference"],
  },
  {
    value: "📎",
    label: "Attachment",
    shortcode: "paperclip",
    aliases: ["file", "attach"],
  },
  {
    value: "📅",
    label: "Schedule",
    shortcode: "calendar",
    aliases: ["date", "event"],
  },
  {
    value: "⏰",
    label: "Deadline",
    shortcode: "alarm_clock",
    aliases: ["time", "due"],
  },
  {
    value: "⏳",
    label: "Waiting",
    shortcode: "hourglass_flowing_sand",
    aliases: ["pending", "later"],
  },
  {
    value: "⭐",
    label: "Star",
    shortcode: "star",
    aliases: ["favorite", "important"],
  },
  {
    value: "✨",
    label: "Polish",
    shortcode: "sparkles",
    aliases: ["magic", "improve"],
  },
  {
    value: "🎉",
    label: "Success",
    shortcode: "tada",
    aliases: ["party", "celebrate"],
  },
  {
    value: "🏆",
    label: "Winner",
    shortcode: "trophy",
    aliases: ["award", "achievement"],
  },
  {
    value: "💯",
    label: "Perfect",
    shortcode: "100",
    aliases: ["hundred", "score"],
  },
  {
    value: "❓",
    label: "Question",
    shortcode: "question",
    aliases: ["unknown", "help"],
  },
  {
    value: "❗",
    label: "Important",
    shortcode: "exclamation",
    aliases: ["attention", "priority"],
  },
  {
    value: "⚠️",
    label: "Warning",
    shortcode: "warning",
    aliases: ["caution", "risk"],
  },
  {
    value: "🚨",
    label: "Alert",
    shortcode: "rotating_light",
    aliases: ["incident", "emergency", "warning"],
  },
  {
    value: "🛡️",
    label: "Protection",
    shortcode: "shield",
    aliases: ["security", "defense"],
  },
  {
    value: "🔑",
    label: "Access",
    shortcode: "key",
    aliases: ["auth", "permission"],
  },
  {
    value: "📈",
    label: "Trending up",
    shortcode: "chart_with_upwards_trend",
    aliases: ["increase", "growth"],
  },
  {
    value: "📉",
    label: "Trending down",
    shortcode: "chart_with_downwards_trend",
    aliases: ["decrease", "decline"],
  },
  {
    value: "🧠",
    label: "Brainstorm",
    shortcode: "brain",
    aliases: ["think", "knowledge"],
  },
  {
    value: "☕",
    label: "Coffee",
    shortcode: "coffee",
    aliases: ["break", "cafe"],
  },
  {
    value: "🌐",
    label: "Web",
    shortcode: "globe_with_meridians",
    aliases: ["internet", "browser"],
  },
  {
    value: "🏠",
    label: "Home",
    shortcode: "house",
    aliases: ["homepage", "local"],
  },
  {
    value: "📁",
    label: "Folder",
    shortcode: "file_folder",
    aliases: ["directory", "files"],
  },
  {
    value: "🔄",
    label: "Refresh",
    shortcode: "arrows_counterclockwise",
    aliases: ["reload", "sync"],
  },
  {
    value: "🧹",
    label: "Cleanup",
    shortcode: "broom",
    aliases: ["clean", "chore"],
  },
  {
    value: "🧰",
    label: "Toolbox",
    shortcode: "toolbox",
    aliases: ["tools", "kit"],
  },
  {
    value: "🪄",
    label: "Magic",
    shortcode: "magic_wand",
    aliases: ["generate", "transform"],
  },
];

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/^:+|:+$/gu, "")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function matchScore(option: GroupEmojiOption, query: string): number | null {
  if (option.value === query) return 0;
  const terms = [option.label, option.shortcode, ...option.aliases].map(
    normalizeSearchText,
  );
  if (terms.some((term) => term === query)) return 1;
  if (terms.some((term) => term.startsWith(query))) return 2;
  if (terms.some((term) => term.includes(query))) return 3;
  return null;
}

export function searchGroupEmojis(
  rawQuery: string,
): readonly GroupEmojiOption[] {
  const query = normalizeSearchText(rawQuery);
  if (!query) return GROUP_EMOJI_OPTIONS;

  return GROUP_EMOJI_OPTIONS.map((option, index) => ({
    index,
    option,
    score: matchScore(option, query),
  }))
    .filter(
      (
        result,
      ): result is { index: number; option: GroupEmojiOption; score: number } =>
        result.score !== null,
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ option }) => option);
}
