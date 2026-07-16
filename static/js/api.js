/**
 * 后端 HTTP 接口封装
 */

var API_BASE = "";

/* ---------- Token ---------- */
function getToken() {
  return localStorage.getItem("access_token") || "";
}
function setToken(t) {
  localStorage.setItem("access_token", t);
}
function clearToken() {
  localStorage.removeItem("access_token");
}
function isLoggedIn() {
  return !!getToken();
}
function logout() {
  clearToken();
  window.location.href = "/static/index.html";
}

/* ---------- 基础请求 ---------- */
async function apiGet(path) {
  var resp = await fetch(API_BASE + path);
  var data = await resp.json();
  if (resp.status === 401) {
    _handle401(data);
  }
  return data;
}
async function apiPost(path, body) {
  var resp = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  var data = await resp.json();
  if (resp.status === 401) {
    _handle401(data);
  }
  return data;
}
async function apiUpload(file) {
  var form = new FormData();
  form.append("token", getToken());
  form.append("file", file);
  var resp = await fetch(API_BASE + "/upload/file", { method: "POST", body: form });
  return await resp.json();
}

/**
 * 统一 401 处理：只有 token 真正过期才跳转登录页
 * 账号密码错误的 401 不触发退出
 */
function _handle401(data) {
  var detail = (data.detail || "").toLowerCase();
  // 仅 token 相关错误才跳转
  if (detail.indexOf("token") !== -1 || detail.indexOf("过期") !== -1 || detail.indexOf("失效") !== -1 || detail.indexOf("expire") !== -1) {
    alert("登录已过期，请重新登录");
    logout();
  }
  // 其他 401（如账号密码错误）由调用方自行处理
}

/* ---------- API 方法 ---------- */
var UserAPI = {
  register: function(u, p) { return apiPost("/user/register", { username: u, password: p }); },
  login: function(u, p)    { return apiPost("/user/login",    { username: u, password: p }); }
};

var FriendAPI = {
  apply: function(name) {
    return apiPost("/friend/apply", { token: getToken(), friend_username: name });
  },
  applyList: function() {
    return apiGet("/friend/apply/list?token=" + getToken());
  },
  dealApply: function(id, op) {
    return apiPost("/friend/apply/deal", { token: getToken(), apply_id: id, operate: op });
  },
  friendList: function() {
    return apiGet("/friend/list?token=" + getToken());
  },
  search: function(kw) {
    return apiGet("/friend/search?token=" + getToken() + "&keyword=" + encodeURIComponent(kw));
  },
  profile: function(friendUsername) {
    return apiGet("/friend/profile?token=" + getToken() + "&friend_username=" + encodeURIComponent(friendUsername));
  },
  setRemark: function(friendUsername, remark) {
    return apiPost("/friend/remark", { token: getToken(), friend_username: friendUsername, remark: remark });
  },
  getRemark: function(friendUsername) {
    return apiGet("/friend/remark?token=" + getToken() + "&friend_username=" + encodeURIComponent(friendUsername));
  },
  deleteFriend: function(friendUsername) {
    return apiPost("/friend/delete", { token: getToken(), friend_username: friendUsername });
  },
  setMute: function(friendUsername, isMuted) {
    return apiPost("/friend/mute?token=" + getToken() + "&friend_username=" + encodeURIComponent(friendUsername) + "&is_muted=" + (isMuted ? 1 : 0));
  },
  getMute: function(friendUsername) {
    return apiGet("/friend/mute?token=" + getToken() + "&friend_username=" + encodeURIComponent(friendUsername));
  }
};

var GroupAPI = {
  create: function(name) {
    return apiPost("/group/create", { token: getToken(), group_name: name });
  },
  list: function() {
    return apiGet("/group/list?token=" + getToken());
  },
  members: function(gid) {
    return apiGet("/group/members?token=" + getToken() + "&group_id=" + gid);
  },
  invite: function(gid, uname) {
    return apiPost("/group/join", { token: getToken(), group_id: gid, friend_username: uname });
  },
  history: function(gid) {
    return apiPost("/group/history", { token: getToken(), group_id: gid });
  },
  leave: function(gid) {
    return apiPost("/group/leave", { token: getToken(), group_id: gid });
  },
  // group management
  update: function(gid, data) {
    return apiPost("/group/update", Object.assign({ token: getToken(), group_id: gid }, data));
  },
  kick: function(gid, targetUid) {
    return apiPost("/group/kick", { token: getToken(), group_id: gid, target_uid: targetUid });
  },
  mute: function(gid, targetUid, duration) {
    return apiPost("/group/mute", { token: getToken(), group_id: gid, target_uid: targetUid, duration: duration });
  },
  unmute: function(gid, targetUid) {
    return apiPost("/group/unmute", { token: getToken(), group_id: gid, target_uid: targetUid });
  },
  setAdmin: function(gid, targetUid) {
    return apiPost("/group/admin/set", { token: getToken(), group_id: gid, target_uid: targetUid });
  },
  revokeAdmin: function(gid, targetUid) {
    return apiPost("/group/admin/revoke", { token: getToken(), group_id: gid, target_uid: targetUid });
  },
  transfer: function(gid, newOwnerUid) {
    return apiPost("/group/transfer", { token: getToken(), group_id: gid, new_owner_uid: newOwnerUid });
  },
  disband: function(gid) {
    return apiPost("/group/disband", { token: getToken(), group_id: gid });
  },
  announcement: function(gid) {
    return apiGet("/group/announcement?token=" + getToken() + "&group_id=" + gid);
  },
  events: function(gid) {
    return apiGet("/group/events?token=" + getToken() + "&group_id=" + gid);
  },
  applyList: function(gid) {
    return apiGet("/group/apply/list?token=" + getToken() + "&group_id=" + gid);
  },
  dealApply: function(rid, op) {
    return apiPost("/group/apply/deal", { token: getToken(), request_id: rid, operate: op });
  },
  muteSetting: function(gid, muted) {
    return apiPost("/group/mute_setting?token=" + getToken() + "&group_id=" + gid + "&is_muted=" + (muted ? 1 : 0));
  },
  getMuteSetting: function(gid) {
    return apiGet("/group/mute_setting?token=" + getToken() + "&group_id=" + gid);
  }
};

var ChatAPI = {
  history: function(uname) {
    return apiPost("/chat/history", { token: getToken(), target_username: uname });
  }
};

var ConvAPI = {
  list: function() {
    return apiGet("/conversation/list?token=" + getToken());
  }
};
