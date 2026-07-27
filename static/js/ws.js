/**
 * WebSocket 客户端（微信风格版本）
 */
var chatSocket = {
  ws: null,
  onMsg: null,
  _timer: null,
  _closed: false,

  connect: function() {
    var token = getToken();
    if (!token) return;
    this._closed = false;
    var proto = window.location.protocol === "https:" ? "wss://" : "ws://";
    var url = proto + window.location.host + "/ws/chat?token=" + encodeURIComponent(token);
    this.ws = new WebSocket(url);

    this.ws.onopen = function() {
      console.log("[WS] 已连接");
      updateWsStatus(true);
      if (chatSocket._timer) { clearTimeout(chatSocket._timer); chatSocket._timer = null; }
    };
    this.ws.onmessage = function(e) {
      try {
        var d = JSON.parse(e.data);
        if (chatSocket.onMsg) chatSocket.onMsg(d);
      } catch (ex) { console.error("[WS] 解析失败", ex); }
    };
    this.ws.onclose = function(ev) {
      console.log("[WS] 断开 code=" + ev.code + " reason=" + ev.reason);
      updateWsStatus(false);
      if (!chatSocket._closed && isLoggedIn()) {
        chatSocket._timer = setTimeout(function() { chatSocket.connect(); }, 3000);
      }
    };
    this.ws.onerror = function(err) {
      console.error("[WS] 连接错误（可能是 ngrok WSS 问题或网络不通）");
      updateWsStatus(false);
    };
  },

  sendPrivate: function(toUser, content, msgType, tempKey) {
    this._send({
      type: "send_msg",
      receiver_username: toUser,
      content: content,
      message_type: msgType || 0,
      temp_key: tempKey || ""
    });
  },

  sendGroup: function(gid, content, msgType, tempKey) {
    this._send({
      type: "send_group_msg",
      group_id: gid,
      content: content,
      message_type: msgType || 0,
      temp_key: tempKey || ""
    });
  },

  sendRecall: function(msgId, targetUser) {
    this._send({ type: "recall_msg", message_id: msgId, target_username: targetUser });
  },

  _send: function(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  },

  disconnect: function() {
    this._closed = true;
    if (this._timer) clearTimeout(this._timer);
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
};
