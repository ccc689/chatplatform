/**
 * 表情包映射表
 * 消息中发送标记（如 [smile]），前端渲染为 emoji 字符
 */
const EMOJI_MAP = {
    "[smile]": "😊",
    "[angry]": "😡",
    "[cry]": "😭",
    "[pout]": "😗",
    "[daze]": "😳",
    "[proud]": "😎"
};

/** 获取表情标记对应的 emoji 字符 */
function emojiGet(mark) {
    return EMOJI_MAP[mark] || mark;
}

/** 将消息中的表情标记替换为 emoji */
function emojiReplace(text) {
    let result = text;
    for (const [mark, emoji] of Object.entries(EMOJI_MAP)) {
        result = result.split(mark).join(emoji);
    }
    return result;
}

/** 所有表情列表（用于表情面板） */
const EMOJI_LIST = Object.entries(EMOJI_MAP).map(([mark, emoji]) => ({ mark, emoji }));
