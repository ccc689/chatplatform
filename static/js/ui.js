/**
 * 聊天平台 v4 — 微信交互完整版
 * 已读 / 时间 / 输入中 / 右键 / 多选 / 收藏 / 弹窗层级
 */
/* ==================== 全局状态 ==================== */
var currentChat = null;
var friendListCache = [];
var groupListCache = [];
var convListCache = [];
var myUsername = "";
var myAvatar = "";
var myStatus = "";

/* ==================== 个性状态预设库 ==================== */
var STATUS_PRESETS = [
  "😌 摸鱼中", "😴 休息勿扰", "💼 工作忙碌", "☕ 休闲放空",
  "🎮 游戏中", "📚 学习备考", "😊 美滋滋", "🚶 外出不在"
];

function ensureEmojiPrefix(text) {
  if (!text.trim()) return "";
  // 如果第一个字符已经是emoji则直接返回
  if (/^[\u{1F000}-\u{1FFFF}]|^[\u{2600}-\u{27BF}]|^[\u{2300}-\u{23FF}]/u.test(text.trim())) return text.trim();
  return "😊 " + text.trim();
}
var contextConvId = null;
var contextMsgData = null;
var profileTarget = null;
var lastMsgDate = null;
var typingTimer = null;
var multiSelectMode = false;
var multiSelected = new Set();
var $ = function(id) { return document.getElementById(id); };

/* ==================== localStorage ==================== */
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch(e) { return []; } }
function lsSet(k,v) { localStorage.setItem(k, JSON.stringify(v)); }
function getPinned(){return lsGet("pinned_convs");} function setPinned(v){lsSet("pinned_convs",v);}
function getMuted(){return lsGet("muted_convs");} function setMuted(v){lsSet("muted_convs",v);}
function getNotes(){try{return JSON.parse(localStorage.getItem("friend_notes"))||{};}catch(e){return{};}} function setNotes(v){localStorage.setItem("friend_notes",JSON.stringify(v));}
function getDeleted(){return lsGet("deleted_convs");} function setDeleted(v){lsSet("deleted_convs",v);}
function getFavs(){return lsGet("favorites");} function setFavs(v){lsSet("favorites",v);}
function getTheme(){return localStorage.getItem("theme")||"light";} function setTheme(v){localStorage.setItem("theme",v);}
function convKey(t,id){return t+"_"+id;}

/* ==================== 微信时间格式化 ==================== */
function pad(n){return n<10?"0"+n:n;}
function formatWechatTime(ts) {
  if(!ts) return "";
  var now=new Date(), t=new Date(ts.replace(/-/g,"/"));
  var diff=now-t, min=Math.floor(diff/60000), hr=Math.floor(diff/3600000);
  if(min<1) return "刚刚";
  if(min<60) return min+"分钟前";
  var td=t.getDate(), nd=now.getDate(), tm=t.getMonth(), nm=now.getMonth(), ty=t.getFullYear(), ny=now.getFullYear();
  if(hr<24 && td===nd && tm===nm && ty===ny) return hr+"小时前";
  var yest=new Date(now);yest.setDate(nd-1);
  if(td===yest.getDate() && tm===yest.getMonth()) return "昨天 "+pad(t.getHours())+":"+pad(t.getMinutes());
  var dbf=new Date(now);dbf.setDate(nd-2);
  if(td===dbf.getDate() && tm===dbf.getMonth()) return "前天 "+pad(t.getHours())+":"+pad(t.getMinutes());
  var daysDiff=Math.floor(diff/86400000);
  if(daysDiff<7 && ty===ny) { var w=["周日","周一","周二","周三","周四","周五","周六"]; return w[t.getDay()]; }
  if(ty===ny) return pad(tm+1)+"-"+pad(td)+" "+pad(t.getHours())+":"+pad(t.getMinutes());
  return ty+"-"+pad(tm+1)+"-"+pad(td)+" "+pad(t.getHours())+":"+pad(t.getMinutes());
}

/* ==================== 暗色模式 ==================== */
function toggleTheme(){var n=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",n);setTheme(n);var b=$("themeToggle");if(b)b.textContent=n==="dark"?"☀️":"🌙";var c=$("darkToggle");if(c)c.checked=(n==="dark");}
function applyTheme(){var t=getTheme();document.documentElement.setAttribute("data-theme",t);var b=$("themeToggle");if(b)b.textContent=t==="dark"?"☀️":"🌙";var c=$("darkToggle");if(c)c.checked=(t==="dark");}

/* ==================== 初始化 ==================== */
window.addEventListener("DOMContentLoaded",function(){
  if(!isLoggedIn()){window.location.href="/static/index.html";return;}
  myUsername=localStorage.getItem("my_username")||"我";myAvatar=localStorage.getItem("my_avatar")||"";myStatus=localStorage.getItem("my_status")||"";
  $("myUsername").textContent=myUsername;applyTheme();refreshMyAvatar();
  chatSocket.onMsg=handleWsMessage;chatSocket.connect();
  buildEmojiPanel();bindPlusMenu();bindGlobalClicks();bindLogout();
  loadMyProfile();loadConversations();loadFriends();loadGroups();loadApplyBadge();updateMyStatusDisplay();
});
function bindLogout(){$("logoutBtn").onclick=function(){if(confirm("确定退出？"))logout();};}
function bindPlusMenu(){var b=$("plusBtn"),d=$("plusDropdown");if(!b||!d)return;b.onclick=function(e){e.stopPropagation();d.classList.toggle("visible");};}
function bindGlobalClicks(){
  document.addEventListener("click",function(e){var t=e.target,w=$("plusMenuWrapper");if(w&&!w.contains(t)){var d=$("plusDropdown");if(d)d.classList.remove("visible");}[$("convContextMenu"),$("msgContextMenu"),$("profileCard")].forEach(function(m){if(m&&!m.contains(t))m.classList.remove("visible");});var sd=$("searchDropdown"),si=$("convSearchInput");if(sd&&!sd.contains(t)&&si&&t!==si)sd.classList.remove("visible");});
  document.addEventListener("click",function(e){if(e.target.classList.contains("modal-overlay"))e.target.classList.remove("visible");});
}

/* ==================== 个人信息 ==================== */
async function loadMyProfile(){try{var r=await fetch("/user/profile?token="+getToken()),d=await r.json();if(d.code===200){if(d.data.avatar){myAvatar=d.data.avatar;localStorage.setItem("my_avatar",myAvatar);}if(d.data.username){myUsername=d.data.username;localStorage.setItem("my_username",myUsername);$("myUsername").textContent=myUsername;}if(d.data.status_message!==undefined){myStatus=d.data.status_message;localStorage.setItem("my_status",myStatus);}refreshMyAvatar();}}catch(e){}}
function refreshMyAvatar(){var i=$("sidebarAvatarImg"),f=$("sidebarAvatarFallback");if(myAvatar&&i){i.src=myAvatar;i.style.display="block";if(f)f.style.display="none";}else{if(i)i.style.display="none";if(f){f.style.display="flex";f.textContent=(myUsername||"?").charAt(0).toUpperCase();}}var pi=$("profileAvatarImg"),pf=$("profileAvatarFallback");if(myAvatar&&pi){pi.src=myAvatar;pi.style.display="block";if(pf)pf.style.display="none";}else{if(pi)pi.style.display="none";if(pf){pf.style.display="flex";pf.textContent=(myUsername||"?").charAt(0).toUpperCase();}}}
function showMyProfile(){$("profileNickname").textContent=myUsername;$("profileStatus").textContent=myStatus||"未设置";refreshMyAvatar();$("nicknameEditArea").style.display="none";$("statusEditArea").style.display="none";$("myProfileModal").classList.add("visible");$("profileLogoutBtn").onclick=function(){if(confirm("确定退出？"))logout();};}
function uploadAvatar(e){var f=e.target.files[0];if(!f)return;e.target.value="";if(!f.type.match(/^image\/(jpeg|png)$/)){alert("仅支持JPG/PNG");return;}if(f.size>5*1024*1024){alert("最大5MB");return;}var r=new FileReader();r.onload=function(ev){$("profileAvatarImg").src=ev.target.result;$("profileAvatarImg").style.display="block";$("profileAvatarFallback").style.display="none";};r.readAsDataURL(f);var fd=new FormData();fd.append("token",getToken());fd.append("file",f);fetch("/upload/file",{method:"POST",body:fd}).then(function(r){return r.json();}).then(async function(d){if(d.code===200){myAvatar=d.file_url;localStorage.setItem("my_avatar",myAvatar);await fetch("/user/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:getToken(),avatar:myAvatar})});refreshMyAvatar();}else alert("上传失败");});}
function editNickname(){$("nicknameEditArea").style.display="block";$("nicknameInput").value=myUsername;$("nicknameInput").focus();}
async function saveNickname(){var v=$("nicknameInput").value.trim();$("nicknameEditArea").style.display="none";if(!v||v===myUsername||v.length<2)return;if(v.length>12){alert("最多12字");return;}var r=await fetch("/user/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:getToken(),nickname:v})}),d=await r.json();if(d.code===200){myUsername=d.data.username;localStorage.setItem("my_username",myUsername);$("myUsername").textContent=myUsername;$("profileNickname").textContent=myUsername;refreshMyAvatar();loadConversations();}}
function editStatus(){
  $("myProfileModal").classList.remove("visible");
  showStatusEditModal();
}

/* ==================== 个性状态显示 ==================== */
function updateMyStatusDisplay(){
  var el = $("myStatusDisplay");
  if (el) el.textContent = myStatus || "";
}

/* ==================== 状态编辑弹窗 ==================== */
function showStatusEditModal(){
  buildStatusPresets();
  $("statusCustomInput").value = myStatus || "";
  $("statusEditModal").classList.add("visible");
  // 表情按钮
  buildStatusEmojiPanel();
}

function buildStatusPresets(){
  var c = $("statusPresets");
  c.innerHTML = STATUS_PRESETS.map(function(s){
    var sel = s === myStatus ? " selected" : "";
    return '<div class="status-preset-item'+sel+'" onclick="selectStatusPreset(\'' + escapeHtml(s) + '\')">' + s + '</div>';
  }).join("");
}

function selectStatusPreset(val){
  $("statusCustomInput").value = val;
  document.querySelectorAll(".status-preset-item").forEach(function(el){ el.classList.remove("selected"); });
  event.target.classList.add("selected");
}

function buildStatusEmojiPanel(){
  var p = $("statusEmojiPanel");
  if (!p) return;
  p.innerHTML = "";
  EMOJI_LIST.forEach(function(item){
    var s = document.createElement("span");
    s.className = "emoji-item"; s.style.fontSize = "22px";
    s.textContent = item.emoji; s.title = item.mark;
    s.onclick = function(){
      $("statusCustomInput").value += item.mark;
    };
    p.appendChild(s);
  });
  // toggle
  $("statusEmojiBtn").onclick = function(e){
    e.stopPropagation();
    p.style.display = p.style.display === "flex" ? "none" : "flex";
  };
}

async function saveStatusFromModal(){
  var v = $("statusCustomInput").value.trim();
  if (v.length > 20){ alert("最多20字"); return; }
  v = ensureEmojiPrefix(v);
  var r = await fetch("/user/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:getToken(),status_message:v})});
  var d = await r.json();
  if(d.code===200){
    myStatus = d.data.status_message || "";
    localStorage.setItem("my_status", myStatus);
    $("profileStatus").textContent = myStatus || "未设置";
    updateMyStatusDisplay();
    loadConversations(); // 刷新会话列表中的状态
    $("statusEditModal").classList.remove("visible");
  } else { alert(d.detail || "保存失败"); }
}

/* ==================== 设置 & 弹窗层级 ==================== */
function showSettings(){$("settingsModal").classList.add("visible");$("darkToggle").checked=(getTheme()==="dark");$("changePwdArea").style.display="none";}
function backToProfile(){closeModal("settingsModal");showMyProfile();}
function showFavorites(){closeModal("settingsModal");renderFavorites();$("favoritesModal").classList.add("visible");}
function showChangePwd(){$("changePwdArea").style.display="block";}
function saveSetting(k,v){localStorage.setItem("setting_"+k,v?"1":"0");}
async function changePassword(){var o=$("oldPwd").value,n1=$("newPwd").value,n2=$("newPwd2").value;if(!o||!n1){alert("请填写完整");return;}if(n1.length<6){alert("至少6位");return;}if(n1!==n2){alert("不一致");return;}alert("需后端接口支持");}

/* ==================== 收藏 ==================== */
function favMsg(){if(!contextMsgData||!contextMsgData.content)return;$("msgContextMenu").classList.remove("visible");var favs=getFavs();favs.push({content:contextMsgData.content, time:contextMsgData.time, sender:contextMsgData.sender, msgType:0, addedAt:new Date().toISOString()});setFavs(favs);}
function renderFavorites(){var favs=getFavs(),c=$("favoritesList");if(favs.length===0){c.innerHTML='<div style="text-align:center;color:var(--text-sub);padding:30px;">暂无收藏</div>';return;}c.innerHTML=favs.map(function(f,i){return'<div class="fav-item"><div class="fav-content">'+escapeHtml(f.content).slice(0,200)+'</div><div class="fav-meta">'+formatWechatTime(f.addedAt)+'</div><span class="fav-del" onclick="delFav('+i+')">✕</span></div>';}).join("");}
function delFav(i){var favs=getFavs();favs.splice(i,1);setFavs(favs);renderFavorites();}
function multiFav(){var favs=getFavs();multiSelected.forEach(function(k){var el=document.querySelector('.msg-row[data-msg-key="'+k+'"]');if(el){favs.push({content:el.getAttribute("data-msg-content"),time:el.getAttribute("data-msg-time"),sender:el.getAttribute("data-msg-sender"),msgType:0,addedAt:new Date().toISOString()});}});setFavs(favs);exitMultiSelect();}

/* ==================== WebSocket ==================== */
function handleWsMessage(msg){
  if(msg.type==="error")return;
  if(msg.type==="typing"){if(currentChat&&currentChat.type==="private"&&currentChat.name===msg.sender_username){showTyping(true);}return;}
  if(msg.type==="stop_typing"){showTyping(false);return;}

  // 收到已读回执：对方已打开会话 → 我方所有发给该用户的消息显示「已读」
  if(msg.type==="read_receipt"){
    document.querySelectorAll('.msg-row.me').forEach(function(r){
      if(currentChat&&currentChat.type==="private"&&currentChat.name===msg.reader_username){
        var rs=r.querySelector('.msg-read-status');if(rs){rs.textContent="已读";rs.classList.add("read");}
      }
    });
    return;
  }

  // 群聊已读更新
  if(msg.type==="group_read_update"){
    // 更新当前群聊中自己发的消息的已读计数
    if(currentChat&&currentChat.type==="group"&&currentChat.target_id===msg.group_id){
      var count=0;
      document.querySelectorAll('.msg-row.me').forEach(function(r){
        var rs=r.querySelector('.msg-read-status');if(rs){count++;rs.textContent=count+"人已读";if(!rs.classList.contains("clickable")){rs.classList.add("clickable");rs.onclick=function(){showReadMembers(r.getAttribute("data-read-key"));};}}
      });
    }
    return;
  }

  if(msg.type==="new_msg"){
    if(currentChat&&currentChat.type==="private"&&currentChat.name===msg.sender_username){appendBubble("other",msg.sender_username,msg.content,msg.message_type,msg.create_at,msg.id);showTyping(false);}
    loadConversations();if(!currentChat||currentChat.type!=="private"||currentChat.name!==msg.sender_username)highlightConvItem("private",0,msg.sender_username);
  }
  if(msg.type==="new_group_msg"){
    if(currentChat&&currentChat.type==="group"&&currentChat.target_id===msg.group_id)appendBubble("other",msg.sender_username,msg.content,msg.message_type,msg.create_at,msg.id);
    loadConversations();
  }
}
function highlightConvItem(type,id,name){var k=convKey(type,id||name);document.querySelectorAll(".conv-item").forEach(function(it){if(it.getAttribute("data-conv-key")===k){it.classList.add("new-highlight");setTimeout(function(){it.classList.remove("new-highlight");},2000);}});}

/* ==================== 正在输入 ==================== */
var typingSendTimer=null;
function sendTyping(){
  if(!currentChat||currentChat.type!=="private")return;
  chatSocket._send({type:"typing",target_username:currentChat.name});
  if(typingSendTimer)clearTimeout(typingSendTimer);
  typingSendTimer=setTimeout(function(){chatSocket._send({type:"stop_typing",target_username:currentChat.name});},3000);
}
function showTyping(show){var s=$("chatSubtitle");if(!s)return;if(show){s.innerHTML='<span style="font-size:12px;color:var(--text-sub);font-style:italic;">对方正在输入…</span>';}else{var status="";if(currentChat&&currentChat.type==="private"){var fc=convListCache.find(function(c){return c.type==="private"&&c.name===currentChat.name;});status=(fc&&fc.status_message)||"";}s.textContent=status;}}

/* ==================== 数据加载 ==================== */
async function loadConversations(){try{var r=await ConvAPI.list();convListCache=r.data||[];applyLocalOverrides();renderConversations();}catch(e){}}
function applyLocalOverrides(){var n=getNotes(),p=getPinned(),m=getMuted(),d=getDeleted();convListCache=convListCache.filter(function(c){return d.indexOf(convKey(c.type,c.target_id))===-1;});convListCache.forEach(function(c){var nk=c.type==="private"?c.name:convKey("group",c.target_id);if(n[nk])c._note=n[nk];c._pinned=p.indexOf(convKey(c.type,c.target_id))!==-1;c._muted=m.indexOf(convKey(c.type,c.target_id))!==-1;});convListCache.sort(function(a,b){if(a._pinned&&!b._pinned)return-1;if(!a._pinned&&b._pinned)return 1;return(b.last_time_sort||b.last_time||"0").localeCompare(a.last_time_sort||a.last_time||"0");});}
async function loadFriends(){try{var r=await FriendAPI.friendList();friendListCache=r.friend_list||[];}catch(e){}}
async function loadGroups(){try{var r=await GroupAPI.list();groupListCache=r.data||[];}catch(e){}}
async function loadApplyBadge(){try{var r=await FriendAPI.applyList(),n=(r.data||[]).length;var b=$("applyBadge");if(b)b.textContent=n>0?"("+n+")":"";var p=$("plusBadge");if(p){if(n>0)p.classList.add("visible");else p.classList.remove("visible");}}catch(e){}}

/* ==================== 会话列表 ==================== */
function renderConversations(){
  var c=$("conversationList"),kw=($("convSearchInput")||{}).value||"",list=convListCache;
  if(kw){kw=kw.toLowerCase();list=list.filter(function(c){return(c.name||"").toLowerCase().indexOf(kw)!==-1||((c.last_msg||"").toLowerCase().indexOf(kw)!==-1);});}
  c.innerHTML=list.map(function(cn){
    var k=convKey(cn.type,cn.target_id),active=currentChat&&currentChat.target_id===cn.target_id&&currentChat.type===cn.type?" active":"";
    return'<div class="conv-item'+active+(cn._pinned?" pinned":"")+'" onclick="openConversation(\''+cn.type+'\','+cn.target_id+',\''+escapeHtml(cn.name)+'\')" oncontextmenu="onConvContext(event,\''+cn.type+'\','+cn.target_id+',\''+escapeHtml(cn.name)+'\')" data-conv-key="'+k+'"><div class="conv-avatar'+(cn.type==="group"?" group-avatar":"")+'">'+(cn.type==="group"?"👥":"👤")+'</div><div class="conv-info"><div class="conv-name">'+(cn._pinned?"📌 ":"")+escapeHtml(cn._note||cn.name)+'</div><div class="conv-preview">'+escapeHtml(cn.last_msg||"").slice(0,40)+'</div>'+(cn.status_message&&cn.type==="private"?'<div class="conv-status">'+escapeHtml(cn.status_message)+'</div>':"")+'</div><div class="conv-meta"><div class="conv-time">'+formatWechatTime(cn.last_time)+'</div>'+(cn.unread>0?'<div class="conv-badge">'+(cn.unread>9?"9+":cn.unread)+'</div>':"")+'</div>'+(cn._muted?'<span class="dnd-icon">🔕</span>':"")+'</div>';
  }).join("");
}
function onSearchConversations(){
  var kw=($("convSearchInput").value||"").trim().toLowerCase(),dd=$("searchDropdown");
  if(kw.length<1){dd.classList.remove("visible");renderConversations();return;}
  var r=convListCache.filter(function(c){return(c.name||"").toLowerCase().indexOf(kw)!==-1||((c.last_msg||"").toLowerCase().indexOf(kw)!==-1);});
  dd.innerHTML=r.map(function(c){return'<div class="search-dropdown-item" onclick="openConversation(\''+c.type+'\','+c.target_id+',\''+escapeHtml(c.name)+'\');$(\'searchDropdown\').classList.remove(\'visible\');"><div class="sd-avatar">'+(c.type==="group"?"👥":"👤")+'</div><div><div style="font-size:14px;">'+escapeHtml(c._note||c.name)+'</div><div style="font-size:12px;color:var(--text-sub);">'+escapeHtml(c.last_msg||"").slice(0,30)+'</div></div></div>';}).join("");
  dd.classList.add("visible");renderConversations();
}

/* ==================== 打开会话 ==================== */
function openConversation(type,targetId,name){
  exitMultiSelect();currentChat={type:type,target_id:targetId,name:name};lastMsgDate=null;
  $("chatTitle").textContent=name;
  var sub="群聊";
  if(type==="private"){
    // 找好友的个性状态
    var friendConv = convListCache.find(function(c){ return c.type==="private" && c.name===name; });
    sub = (friendConv && friendConv.status_message) ? friendConv.status_message : "";
  }
  $("chatSubtitle").textContent=type==="group"?"群聊":sub;
  $("messageList").innerHTML="";var em=$("messageEmpty");if(em)em.style.display="none";$("chatInputBar").style.display="block";
  var more=type==="group"?'<button class="more-btn" onclick="showGroupMembers()">···</button>':'<button class="more-btn" onclick="showFriendProfile(\''+escapeHtml(name)+'\')">···</button>';
  $("topbarActions").innerHTML='<div class="theme-toggle" id="themeToggle" onclick="toggleTheme()">'+(getTheme()==="dark"?"☀️":"🌙")+'</div>'+more+'<div class="plus-menu-wrapper" id="plusMenuWrapper"><button class="plus-btn" id="plusBtn">+</button><span class="plus-badge" id="plusBadge"></span><div class="plus-dropdown" id="plusDropdown"><div class="plus-dropdown-item" onclick="showAddFriendModal()"><span class="plus-dropdown-icon">👤</span><span>添加好友</span></div><div class="plus-dropdown-item" onclick="showCreateGroupModal()"><span class="plus-dropdown-icon">👥</span><span>发起群聊</span></div></div></div>';
  bindPlusMenu();loadApplyBadge();renderConversations();
  loadHistory().then(function(){loadConversations();});
}
async function loadHistory(){
  if(!currentChat)return;try{var res=currentChat.type==="private"?await ChatAPI.history(currentChat.name):await GroupAPI.history(currentChat.target_id),msgs=res.data||[],list=$("messageList");list.innerHTML="";var em=$("messageEmpty");if(msgs.length===0){if(em)em.style.display="block";}else{if(em)em.style.display="none";}lastMsgDate=null;msgs.forEach(function(m){appendBubble((m.sender_name===myUsername)?"me":"other",m.sender_name,m.content,m.message_type,m.create_at,m.id);});
  // 已读回执：打开会话后通知发送方「我已读」
  if(currentChat.type==="private"){chatSocket._send({type:"mark_read",target_username:currentChat.name});}
  else if(currentChat.type==="group"){chatSocket._send({type:"group_mark_read",group_id:currentChat.target_id});}
  }catch(e){}
}

/* ==================== 消息发送 ==================== */
function sendCurrentChatMessage(){var inp=$("msgInput"),content=inp.value.trim();if(!content||!currentChat)return;content=emojiReplace(content);if(currentChat.type==="private")chatSocket.sendPrivate(currentChat.name,content,0);else chatSocket.sendGroup(currentChat.target_id,content,0);appendBubble("me",myUsername,content,0,formatTime(new Date()),null);inp.value="";inp.style.height="auto";inp.focus();}
function onInputKeydown(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendCurrentChatMessage();}else{sendTyping();}}
function autoResizeTextarea(){var t=$("msgInput");t.style.height="auto";t.style.height=Math.min(t.scrollHeight,120)+"px";}

/* ==================== 文件上传 ==================== */
async function onFileSelect(e,mt){var f=e.target.files[0];if(!f)return;e.target.value="";if(mt===1){if(!f.type.match(/^image\/(jpeg|png)$/)){alert("仅支持JPG/PNG");return;}if(f.size>10*1024*1024){alert("最大10MB");return;}}else{var a=[".pdf",".docx",".xlsx",".pptx"],ex="."+f.name.split(".").pop().toLowerCase();if(a.indexOf(ex)===-1){alert("仅支持PDF/Word/Excel/PPT");return;}if(f.size>50*1024*1024){alert("最大50MB");return;}}var res=await apiUpload(f);if(res.code!==200){alert(res.detail||"失败");return;}if(!currentChat)return;if(currentChat.type==="private")chatSocket.sendPrivate(currentChat.name,res.file_url,mt);else chatSocket.sendGroup(currentChat.target_id,res.file_url,mt);appendBubble("me",myUsername,res.file_url,mt,formatTime(new Date()),null);}

/* ==================== 消息气泡（带头像+已读+时间格式） ==================== */
function appendBubble(side,sender,content,msgType,time,msgId){
  var list=$("messageList"),em=$("messageEmpty");if(em)em.style.display="none";
  if(time){try{var d=time.slice(0,10);if(lastMsgDate&&lastMsgDate!==d){var dv=document.createElement("div");dv.className="time-divider";dv.innerHTML="<span>"+(time?time.slice(0,16):"")+"</span>";list.appendChild(dv);}lastMsgDate=d;}catch(e){}}
  var row=document.createElement("div");row.className="msg-row "+side;
  var key=msgId||("k"+Date.now()+Math.random());row.setAttribute("data-msg-key",key);row.setAttribute("data-msg-id",msgId||"");row.setAttribute("data-msg-content",content||"");row.setAttribute("data-msg-time",time||"");row.setAttribute("data-msg-sender",sender||"");
  row.addEventListener("contextmenu",function(e){onMsgContext(e,row);});

  // 对方消息头像
  if(side==="other"){
    var av=document.createElement("div");av.className="msg-sender-avatar";av.textContent=(sender||"?").charAt(0).toUpperCase();row.appendChild(av);
  }

  var wrap=document.createElement("div");wrap.className="msg-inner-wrap";
  if(side==="other"){var nm=document.createElement("div");nm.className="msg-sender-name";nm.textContent=sender;wrap.appendChild(nm);}
  var bubble=document.createElement("div");bubble.className="msg-bubble";
  var inner=escapeHtml(content);inner=emojiReplace(inner);
  if(msgType===1)inner='<img src="'+escapeHtml(content)+'" class="msg-image" onclick="previewImage(\''+escapeHtml(content)+'\')" onerror="this.style.display=\'none\'">';
  else if(msgType===2){var ext=(content.split(".").pop()||"").toLowerCase(),icons={pdf:"📕",docx:"📘",xlsx:"📗",pptx:"📙"};inner='<a href="'+escapeHtml(content)+'" target="_blank" class="msg-file-link"><span class="file-icon">'+(icons[ext]||"📎")+'</span>'+escapeHtml(content.split("/").pop())+'</a>';}
  bubble.innerHTML=inner;wrap.appendChild(bubble);

  // 时间
  var td=document.createElement("div");td.className="msg-time-text";td.textContent=time?formatWechatTime(time):"";wrap.appendChild(td);

  // 已读状态占位（仅自己发的消息有占位，默认空白，等后端推送 read_receipt 后才显示）
  if(side==="me"){
    var rs=document.createElement("div");rs.className="msg-read-status";rs.setAttribute("data-read-key",key);
    // 初始为空，不显示任何文字
    if(currentChat&&currentChat.type==="group"){rs.classList.add("clickable");rs.onclick=function(){showReadMembers(key);};}
    wrap.appendChild(rs);
  }

  // 多选模式勾选框
  var cb=document.createElement("input");cb.type="checkbox";cb.className="msg-checkbox";cb.setAttribute("data-msg-key",key);
  cb.onchange=function(){if(cb.checked)multiSelected.add(key);else multiSelected.delete(key);updateMultiCount();};
  row.appendChild(cb);

  row.appendChild(wrap);
  if(multiSelectMode)row.classList.add("multiselect-active"),cb.style.display="block";
  list.appendChild(row);list.scrollTop=list.scrollHeight;
}

/* ==================== 消息右键菜单 ==================== */
function onMsgContext(e,row){
  if(multiSelectMode){e.preventDefault();var cb=row.querySelector(".msg-checkbox");if(cb){cb.checked=!cb.checked;if(cb.checked)multiSelected.add(row.getAttribute("data-msg-key"));else multiSelected.delete(row.getAttribute("data-msg-key"));updateMultiCount();}return;}
  e.preventDefault();
  contextMsgData={key:row.getAttribute("data-msg-key"),id:row.getAttribute("data-msg-id"),content:row.getAttribute("data-msg-content"),time:row.getAttribute("data-msg-time"),sender:row.getAttribute("data-msg-sender")};
  var m=$("msgContextMenu");m.style.left=e.clientX+"px";m.style.top=e.clientY+"px";m.classList.add("visible");
  $("msgRecallItem").style.display=(contextMsgData.sender===myUsername&&contextMsgData.time&&isWithin3Min(contextMsgData.time))?"block":"none";
}
function isWithin3Min(t){try{return(Date.now()-new Date(t.replace(/-/g,"/")).getTime())<3*60*1000;}catch(e){return false;}}
function copyMsgText(){if(contextMsgData)navigator.clipboard.writeText(contextMsgData.content).catch(function(){});$("msgContextMenu").classList.remove("visible");}
function recallMsg(){if(!contextMsgData||!isWithin3Min(contextMsgData.time)){alert("仅支持撤回3分钟内的消息");$("msgContextMenu").classList.remove("visible");return;}document.querySelectorAll('.msg-row[data-msg-key="'+contextMsgData.key+'"]').forEach(function(r){r.querySelector(".msg-bubble").innerHTML='<span style="color:var(--text-sub);font-style:italic;">你撤回了一条消息</span>';});$("msgContextMenu").classList.remove("visible");}
function deleteMsgLocal(){if(!contextMsgData)return;document.querySelectorAll('.msg-row[data-msg-key="'+contextMsgData.key+'"]').forEach(function(r){r.remove();});$("msgContextMenu").classList.remove("visible");}
function forwardMsg(){if(!contextMsgData||!contextMsgData.content)return;$("msgContextMenu").classList.remove("visible");showForwardModal(contextMsgData.content);}
function enterMultiSelect(){if(!contextMsgData)return;$("msgContextMenu").classList.remove("visible");multiSelectMode=true;multiSelected.clear();multiSelected.add(contextMsgData.key);$("chatMain").classList.add("multiselect-active");$("multiselectBar").classList.add("visible");document.querySelectorAll(".msg-row").forEach(function(r){r.classList.add("multiselect-active");r.querySelector(".msg-checkbox").style.display="block";});document.querySelectorAll('.msg-row[data-msg-key="'+contextMsgData.key+'"] .msg-checkbox').forEach(function(c){c.checked=true;});updateMultiCount();}
function exitMultiSelect(){multiSelectMode=false;multiSelected.clear();$("chatMain").classList.remove("multiselect-active");$("multiselectBar").classList.remove("visible");document.querySelectorAll(".msg-row").forEach(function(r){r.classList.remove("multiselect-active");var cb=r.querySelector(".msg-checkbox");if(cb){cb.style.display="none";cb.checked=false;}});}
function updateMultiCount(){$("selectedCount").textContent="已选 "+multiSelected.size+" 条";}

/* ==================== 批量操作 ==================== */
function multiDelete(){multiSelected.forEach(function(k){document.querySelectorAll('.msg-row[data-msg-key="'+k+'"]').forEach(function(r){r.remove();});});exitMultiSelect();}
function showForwardModal(content){$("forwardList").innerHTML='<p style="font-size:13px;color:var(--text-sub);margin-bottom:10px;">选择转发目标：</p>'+friendListCache.map(function(n){return'<div class="search-item" onclick="doForward(\''+escapeHtml(n)+'\');closeModal(\'forwardModal\');">👤 '+escapeHtml(n)+'</div>';}).join("")+groupListCache.map(function(g){return'<div class="search-item" onclick="doForwardGroup('+g.group_id+');closeModal(\'forwardModal\');">👥 '+escapeHtml(g.group_name)+'</div>';}).join("");$("forwardModal").classList.add("visible");}
function multiForward(){var contents=[];multiSelected.forEach(function(k){var el=document.querySelector('.msg-row[data-msg-key="'+k+'"]');if(el)contents.push(el.getAttribute("data-msg-content"));});if(contents.length===0)return;showForwardModal(contents.join("\n---\n"));}
function doForward(uname){var c=contextMsgData?contextMsgData.content:(multiSelected.size>0?(document.querySelector('.msg-row[data-msg-key="'+Array.from(multiSelected)[0]+'"]')||{}).getAttribute("data-msg-content")||"":"");if(c&&uname)chatSocket.sendPrivate(uname,c,0);exitMultiSelect();}
function doForwardGroup(gid){var c=contextMsgData?contextMsgData.content:"";if(c&&gid)chatSocket.sendGroup(gid,c,0);exitMultiSelect();}

/* ==================== 已读成员 ==================== */
function showReadMembers(key){$("readMembersList").innerHTML='<div style="font-size:13px;color:var(--text-sub);">群聊已读统计（当前版本展示群内成员列表）</div><br>'+groupListCache.filter(function(g){return currentChat&&currentChat.target_id===g.group_id;}).map(function(){return"<p>功能开发中，敬请期待</p>";}).join("");$("readMembersModal").classList.add("visible");}

/* ==================== 图片预览 ==================== */
function previewImage(url){$("imagePreviewImg").src=url;$("imagePreviewModal").classList.add("visible");}

/* ==================== 会话右键 ==================== */
function onConvContext(e,t,id,n){e.preventDefault();contextConvId={type:t,target_id:id,name:n};var k=convKey(t,id),p=getPinned(),m=getMuted();$("pinLabel").textContent=p.indexOf(k)!==-1?"取消置顶":"置顶会话";$("muteLabel").textContent=m.indexOf(k)!==-1?"关闭免打扰":"消息免打扰";var mn=$("convContextMenu");mn.style.left=e.clientX+"px";mn.style.top=e.clientY+"px";mn.classList.add("visible");}
function togglePinConv(){if(!contextConvId)return;var k=convKey(contextConvId.type,contextConvId.target_id),a=getPinned(),i=a.indexOf(k);if(i!==-1)a.splice(i,1);else a.unshift(k);setPinned(a);$("convContextMenu").classList.remove("visible");loadConversations();}
function toggleMuteConv(){if(!contextConvId)return;var k=convKey(contextConvId.type,contextConvId.target_id),a=getMuted(),i=a.indexOf(k);if(i!==-1)a.splice(i,1);else a.push(k);setMuted(a);$("convContextMenu").classList.remove("visible");loadConversations();}
function deleteConv(){if(!contextConvId)return;if(!confirm("确定删除？仅清空本地记录")){$("convContextMenu").classList.remove("visible");return;}var k=convKey(contextConvId.type,contextConvId.target_id),a=getDeleted();if(a.indexOf(k)===-1)a.push(k);setDeleted(a);$("convContextMenu").classList.remove("visible");if(currentChat&&currentChat.type===contextConvId.type&&currentChat.target_id===contextConvId.target_id){currentChat=null;resetChatView();}loadConversations();}

/* ==================== 好友/群聊快捷函数 ==================== */
function showFriendProfile(n){profileTarget=n;var nt=getNotes();$("profileName").textContent=n;$("profileRemark").textContent=nt[n]?"备注: "+nt[n]:"";$("profileAvatar").textContent=n.charAt(0).toUpperCase();var c=$("profileCard");c.style.left="50%";c.style.top="20%";c.style.transform="translate(-50%,0)";c.classList.add("visible");}
function profileSendMsg(){if(profileTarget)openConversation("private",0,profileTarget);$("profileCard").classList.remove("visible");}
function profileEditRemark(){if(!profileTarget)return;$("remarkInput").value=getNotes()[profileTarget]||"";$("remarkModal").classList.add("visible");$("profileCard").classList.remove("visible");}
function saveRemark(){var v=$("remarkInput").value.trim();if(!profileTarget)return;var n=getNotes();if(v)n[profileTarget]=v;else delete n[profileTarget];setNotes(n);$("remarkModal").classList.remove("visible");loadConversations();}
async function profileDeleteFriend(){if(!profileTarget||!confirm("确定删除？"))return;alert("请通过后端操作");$("profileCard").classList.remove("visible");}
async function showGroupMembers(){if(!currentChat||currentChat.type!=="group")return;var r=await GroupAPI.members(currentChat.target_id),ms=r.data||[];$("groupMembersTitle").textContent="群成员 ("+ms.length+"人)";$("groupMembersList").innerHTML=ms.map(function(m){return'<div class="member-item" ondblclick="openConversation(\'private\',0,\''+escapeHtml(m.username)+'\');closeModal(\'groupMembersModal\');"><div class="member-avatar">'+(m.username||"?").charAt(0).toUpperCase()+'</div><span style="font-size:14px;">'+escapeHtml(m.username)+(m.is_owner?' <span style="font-size:11px;color:var(--green);">群主</span>':'')+'</span></div>';}).join("");$("groupMembersModal").classList.add("visible");}
function showAddFriendModal(){var d=$("plusDropdown");if(d)d.classList.remove("visible");$("friendSearchInput").value="";$("searchResult").innerHTML="";$("applyListInline").style.display="none";$("addFriendModal").classList.add("visible");}
async function onSearchUser(){var kw=$("friendSearchInput").value.trim();if(kw.length<1){$("searchResult").innerHTML="";return;}var r=await FriendAPI.search(kw),d=r.data||[];$("searchResult").innerHTML=d.map(function(u){return'<div class="search-item" onclick="$(\'friendSearchInput\').value=\''+escapeHtml(u.username)+'\'">👤 '+escapeHtml(u.username)+(u.is_friend?' <span style="color:var(--green);font-size:12px;">(已是好友)</span>':'')+'</div>';}).join("");}
async function addFriend(){var n=$("friendSearchInput").value.trim();if(!n){alert("请先搜索");return;}if(!confirm("发送好友申请给「"+n+"」？"))return;await FriendAPI.apply(n);loadFriends();loadApplyBadge();}
async function showApplyListInModal(){var c=$("applyListInline"),r=await FriendAPI.applyList(),d=r.data||[];c.innerHTML=d.length===0?'<div style="text-align:center;color:var(--text-sub);padding:16px 0;">暂无</div>':d.map(function(a){return'<div class="apply-item-row"><span class="apply-user">👤 '+escapeHtml(a.apply_user_name)+'</span><span style="display:flex;gap:6px;"><button class="btn-accept" onclick="handleApply('+a.apply_id+',1)">同意</button><button class="btn-reject" onclick="handleApply('+a.apply_id+',0)">拒绝</button></span></div>';}).join("");c.style.display="block";}
window.handleApply=async function(id,op){await FriendAPI.dealApply(id,op);loadFriends();loadApplyBadge();showApplyListInModal();};
function showCreateGroupModal(){var d=$("plusDropdown");if(d)d.classList.remove("visible");var cc=$("groupMemberCheckboxes");cc.innerHTML=friendListCache.length===0?'<div style="color:var(--text-sub);">暂无好友</div>':friendListCache.map(function(n){return'<label class="modal-check-item"><input type="checkbox" value="'+escapeHtml(n)+'" class="member-check"> '+escapeHtml(n)+'</label>';}).join("");$("newGroupName").value="";$("createGroupModal").classList.add("visible");}
async function createGroup(){var n=$("newGroupName").value.trim(),sel=[];document.querySelectorAll(".member-check:checked").forEach(function(cb){sel.push(cb.value);});var r=await GroupAPI.create(n);if(r.code!==200){alert(r.detail||"失败");return;}for(var i=0;i<sel.length;i++)await GroupAPI.invite(r.group_id,sel[i]);$("createGroupModal").classList.remove("visible");loadGroups();loadConversations();}
async function leaveCurrentGroup(){if(!currentChat||currentChat.type!=="group")return;if(!confirm("确定退出？"))return;await GroupAPI.leave(currentChat.target_id);currentChat=null;resetChatView();loadConversations();loadGroups();}
function resetChatView(){$("chatTitle").textContent="欢迎";$("chatSubtitle").textContent="";$("messageList").innerHTML='<div class="message-empty" id="messageEmpty"><div class="empty-icon">💬</div><div class="empty-text">选择左侧会话开始聊天</div><div class="empty-sub">好友消息、群聊消息都在这里</div></div>';$("messageEmpty").style.display="block";$("chatInputBar").style.display="none";$("topbarActions").innerHTML='<div class="theme-toggle" id="themeToggle" onclick="toggleTheme()">'+(getTheme()==="dark"?"☀️":"🌙")+'</div><div class="plus-menu-wrapper" id="plusMenuWrapper"><button class="plus-btn" id="plusBtn">+</button><span class="plus-badge" id="plusBadge"></span><div class="plus-dropdown" id="plusDropdown"><div class="plus-dropdown-item" onclick="showAddFriendModal()"><span class="plus-dropdown-icon">👤</span><span>添加好友</span></div><div class="plus-dropdown-item" onclick="showCreateGroupModal()"><span class="plus-dropdown-icon">👥</span><span>发起群聊</span></div></div></div>';bindPlusMenu();loadApplyBadge();}

/* ==================== 表情 ==================== */
function buildEmojiPanel(){var p=$("emojiPanel");EMOJI_LIST.forEach(function(i){var s=document.createElement("span");s.className="emoji-item";s.textContent=i.emoji;s.title=i.mark;s.onclick=function(){$("msgInput").value+=i.mark;p.classList.remove("visible");};p.appendChild(s);});}
document.addEventListener("click",function(e){var p=$("emojiPanel"),b=$("emojiBtn");if(!p||!b)return;if(e.target===b||b.contains(e.target)){p.classList.toggle("visible");return;}if(!p.contains(e.target))p.classList.remove("visible");});

/* ==================== 弹窗 ==================== */
function closeModal(id){$(id).classList.remove("visible");}

/* ==================== 工具 ==================== */
/* ==================== WS 连接状态指示 ==================== */
var wsConnected = false;
function updateWsStatus(ok){
  wsConnected = ok;
  var dot = document.getElementById("sidebarOnlineDot");
  if (dot) { dot.style.background = ok ? "var(--green)" : "#ccc"; }
}

function escapeHtml(t){if(!t)return"";var d=document.createElement("div");d.textContent=t;return d.innerHTML;}
function formatTime(d){var m=("0"+(d.getMonth()+1)).slice(-2),day=("0"+d.getDate()).slice(-2),h=("0"+d.getHours()).slice(-2),min=("0"+d.getMinutes()).slice(-2);return d.getFullYear()+"-"+m+"-"+day+" "+h+":"+min;}
