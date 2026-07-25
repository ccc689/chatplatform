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
var myUserId = 0;

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
  var dt=null;
  if(typeof ts==="number"){dt=new Date(ts);}
  else if(typeof ts==="string"){
    var s=ts.replace(/-/g,"/").replace(/\.\d+Z$/,"Z");
    dt=new Date(s);
  }
  else{dt=new Date(ts);}
  if(!dt||isNaN(dt.getTime())) return "";
  var now=new Date(), diff=now-dt, min=Math.floor(diff/60000), hr=Math.floor(diff/3600000);
  var t=dt, td=t.getDate(), nd=now.getDate(), tm=t.getMonth(), nm=now.getMonth(), ty=t.getFullYear(), ny=now.getFullYear();
  if(min<1) return "刚刚";
  if(min<60) return min+"分钟前";
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
  if(!isLoggedIn()){window.location.href="/static/login.html";return;}
  myUsername=sessionStorage.getItem("my_username")||"我";myAvatar=sessionStorage.getItem("my_avatar")||"";myStatus=sessionStorage.getItem("my_status")||"";myUserId=parseInt(sessionStorage.getItem("my_user_id"))||0;
  $("myUsername").textContent=myUsername;applyTheme();refreshMyAvatar();
  chatSocket.onMsg=handleWsMessage;chatSocket.connect();
  safeRun(buildEmojiPanel);safeRun(bindPlusMenu);safeRun(bindGlobalClicks);safeRun(bindLogout);
  safeRun(loadMyProfile);safeRun(loadConversations);safeRun(loadFriends);safeRun(loadGroups);safeRun(loadApplyBadge);safeRun(updateMyStatusDisplay);
});
function safeRun(fn){try{fn();}catch(e){console.error("Init error:",e);}}
function bindLogout(){$("logoutBtn").onclick=function(){$("logoutConfirmModal").classList.add("visible");};}
function confirmLogout(){closeModal("logoutConfirmModal");logout();}
function bindPlusMenu(){var b=$("plusBtn"),d=$("plusDropdown");if(!b||!d)return;b.onclick=function(e){e.stopPropagation();d.classList.toggle("visible");};}
function bindGlobalClicks(){
  document.addEventListener("click",function(e){var t=e.target,w=$("plusMenuWrapper");if(w&&!w.contains(t)){var d=$("plusDropdown");if(d)d.classList.remove("visible");}[$("convContextMenu"),$("msgContextMenu")].forEach(function(m){if(m&&!m.contains(t))m.classList.remove("visible");});var sd=$("searchDropdown"),si=$("convSearchInput");if(sd&&!sd.contains(t)&&si&&t!==si)sd.classList.remove("visible");});
  document.addEventListener("click",function(e){if(e.target.classList.contains("modal-overlay"))e.target.classList.remove("visible");});
}
async function onAttachSelect(e){var f=e.target.files[0];if(!f)return;e.target.value="";if(f.type.match(/^image\/(jpeg|png)$/)){onFileSelectInternal(f,1);}else{onFileSelectInternal(f,2);}}
async function onFileSelectInternal(f,mt){if(mt===1){if(!f.type.match(/^image\/(jpeg|png)$/)){alert("仅支持JPG/PNG");return;}if(f.size>10*1024*1024){alert("最大10MB");return;}}else{var a=[".pdf",".docx",".xlsx",".pptx"],ex="."+f.name.split(".").pop().toLowerCase();if(a.indexOf(ex)===-1){alert("仅支持PDF/Word/Excel/PPT");return;}if(f.size>50*1024*1024){alert("最大50MB");return;}}var res=await apiUpload(f);if(res.code!==200){alert(res.detail||"失败");return;}if(!currentChat)return;if(currentChat.type==="private")chatSocket.sendPrivate(currentChat.name,res.file_url,mt);else chatSocket.sendGroup(currentChat.target_id,res.file_url,mt);appendBubble("me",myUsername,res.file_url,mt,formatTime(new Date()),null);}

/* ==================== 个人信息 ==================== */
async function loadMyProfile(){try{var r=await fetch("/user/profile?token="+getToken()),d=await r.json();if(d.code===200){if(d.data.user_id){myUserId=d.data.user_id;sessionStorage.setItem("my_user_id",myUserId);}if(d.data.avatar){myAvatar=d.data.avatar;sessionStorage.setItem("my_avatar",myAvatar);}if(d.data.username){myUsername=d.data.username;sessionStorage.setItem("my_username",myUsername);$("myUsername").textContent=myUsername;}if(d.data.status_message!==undefined){myStatus=d.data.status_message;sessionStorage.setItem("my_status",myStatus);}refreshMyAvatar();}}catch(e){}}
function refreshMyAvatar(){var i=$("sidebarAvatarImg"),f=$("sidebarAvatarFallback");if(myAvatar&&i){i.src=myAvatar;i.style.display="block";if(f)f.style.display="none";}else{if(i)i.style.display="none";if(f){f.style.display="flex";f.textContent=(myUsername||"?").charAt(0).toUpperCase();}}var pi=$("profileAvatarImg"),pf=$("profileAvatarFallback");if(myAvatar&&pi){pi.src=myAvatar;pi.style.display="block";if(pf)pf.style.display="none";}else{if(pi)pi.style.display="none";if(pf){pf.style.display="flex";pf.textContent=(myUsername||"?").charAt(0).toUpperCase();}}}
function showMyProfile(){$("profileNickname").textContent=myUsername;$("profileStatus").textContent=myStatus||"未设置";refreshMyAvatar();$("nicknameEditArea").style.display="none";$("statusEditArea").style.display="none";$("myProfileModal").classList.add("visible");$("profileLogoutBtn").onclick=function(){if(confirm("确定退出？"))logout();};}
function uploadAvatar(e){var f=e.target.files[0];if(!f)return;e.target.value="";if(!f.type.match(/^image\/(jpeg|png)$/)){alert("仅支持JPG/PNG");return;}if(f.size>5*1024*1024){alert("最大5MB");return;}var r=new FileReader();r.onload=function(ev){$("profileAvatarImg").src=ev.target.result;$("profileAvatarImg").style.display="block";$("profileAvatarFallback").style.display="none";};r.readAsDataURL(f);var fd=new FormData();fd.append("token",getToken());fd.append("file",f);fetch("/upload/file",{method:"POST",body:fd}).then(function(r){return r.json();}).then(async function(d){if(d.code===200){myAvatar=d.file_url;sessionStorage.setItem("my_avatar",myAvatar);await fetch("/user/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:getToken(),avatar:myAvatar})});refreshMyAvatar();}else alert("上传失败");});}
function editNickname(){$("nicknameEditArea").style.display="block";$("nicknameInput").value=myUsername;$("nicknameInput").focus();}
async function saveNickname(){var v=$("nicknameInput").value.trim();if(!v||v===myUsername||v.length<2){$("nicknameEditArea").style.display="none";return;}if(v.length>12){alert("最多12字");return;}var r=await fetch("/user/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:getToken(),nickname:v})}),d=await r.json();if(d.code===200){myUsername=d.data.username;sessionStorage.setItem("my_username",myUsername);$("myUsername").textContent=myUsername;$("profileNickname").textContent=myUsername;refreshMyAvatar();loadConversations();$("nicknameEditArea").style.display="none";}else{alert(d.detail||"修改失败，昵称可能已被占用");}}
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
  var list = buildEmojiList();
  var added = new Set();
  list.forEach(function(item){
    if (added.has(item.emoji)) return;
    added.add(item.emoji);
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
    sessionStorage.setItem("my_status", myStatus);
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
async function changePassword(){var o=$("oldPwd").value,n1=$("newPwd").value,n2=$("newPwd2").value;if(!o||!n1){alert("请填写完整");return;}if(n1.length<6){alert("新密码至少6位");return;}if(n1!==n2){alert("两次密码不一致");return;}var r=await apiPost("/user/change_password",{token:getToken(),old_password:o,new_password:n1});if(r.code===200){alert("密码修改成功");$("changePwdArea").style.display="none";$("oldPwd").value="";$("newPwd").value="";$("newPwd2").value="";}else{alert(r.detail||"修改失败");}}

/* ==================== 收藏 ==================== */
function favMsg(){
  if(!contextMsgData||!contextMsgData.content)return;
  $("msgContextMenu").classList.remove("visible");
  var favs=getFavs();
  favs.push({
    content:contextMsgData.content, time:contextMsgData.time,
    sender:contextMsgData.sender, msgType:contextMsgData.msgType||0,
    chatWith:contextMsgData.chatWith||(currentChat?currentChat.name:""),
    chatType:contextMsgData.chatType||(currentChat?currentChat.type:""),
    addedAt:new Date().toISOString()
  });
  setFavs(favs);
}
var favFolderState = {}; // track which folders are open
function renderFavorites(){
  var favs=getFavs(),c=$("favoritesList");
  if(favs.length===0){c.innerHTML='<div style="text-align:center;color:var(--text-sub);padding:30px;">暂无收藏</div>';return;}
  var groups={}, order=[];
  favs.forEach(function(f,i){
    var label;
    if(!f.chatWith){label="未分类";}
    else if(f.chatType==="group"){label="群聊："+f.chatWith;}
    else{label="与 "+f.chatWith+" 的聊天";}
    if(!groups[label]){groups[label]=[];order.push(label);}
    groups[label].push({i:i,content:f.content,time:f.time,sender:f.sender,msgType:f.msgType||0,addedAt:f.addedAt});
  });
  order.forEach(function(k){groups[k].sort(function(a,b){return new Date(b.addedAt)-new Date(a.addedAt);});});
  order.sort(function(a,b){return new Date(groups[b][0].addedAt)-new Date(groups[a][0].addedAt);});
  var icons={0:"💬",1:"🖼",2:"📎",3:"😊"};
  var html="";
  order.forEach(function(label,gi){
    var items=groups[label];
    var folderId="favFolder"+gi;
    var isOpen=favFolderState[folderId]!==false;
    var arrow=isOpen?"▼":"▶";
    html+='<div style="font-size:13px;color:var(--green);font-weight:600;padding:10px 0;border-top:1px solid var(--border-light);margin-top:4px;cursor:pointer;" onclick="toggleFavFolder(\''+folderId+'\')">'+arrow+' 📁 '+escapeHtml(label)+' <span style="font-weight:400;color:var(--text-sub);font-size:12px;">('+items.length+'条)</span></div>';
    html+='<div id="'+folderId+'" style="'+(isOpen?"":"display:none;")+'">';
    items.forEach(function(f){
      var icon=icons[f.msgType]||"💬",preview="";
      if(f.msgType===1){preview="[图片]";}
      else if(f.msgType===2){preview="[文件] "+escapeHtml(f.content).slice(0,100);}
      else{preview=escapeHtml(f.content).slice(0,120);}
      html+='<div class="fav-item"><div class="fav-content"><span style="margin-right:6px;">'+icon+'</span>'+preview+'</div><div class="fav-meta">'+(f.time?formatWechatTime(f.time)+" · ":"")+"收藏于 "+formatWechatTime(f.addedAt)+'</div><span class="fav-del" onclick="delFav('+f.i+')">✕</span></div>';
    });
    html+='</div>';
  });
  c.innerHTML=html;
}
function toggleFavFolder(id){if(favFolderState[id]===undefined)favFolderState[id]=true;favFolderState[id]=!favFolderState[id];renderFavorites();}
function delFav(i){var favs=getFavs();favs.splice(i,1);setFavs(favs);renderFavorites();}
function multiFav(){var favs=getFavs();multiSelected.forEach(function(k){var el=document.querySelector('.msg-row[data-msg-key="'+k+'"]');if(el){favs.push({content:el.getAttribute("data-msg-content"),time:el.getAttribute("data-msg-time"),sender:el.getAttribute("data-msg-sender"),msgType:parseInt(el.getAttribute("data-msg-type"))||0,chatWith:currentChat?currentChat.name:"",chatType:currentChat?currentChat.type:"",addedAt:new Date().toISOString()});}});setFavs(favs);exitMultiSelect();}

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
    // 如果之前被手动隐藏（deleteConv），收到新消息时自动恢复
    var key=convKey("private",msg.sender_id||msg.sender_username),dels=getDeleted(),dx=dels.indexOf(key);
    if(dx===-1&&msg.sender_username){dx=dels.indexOf(convKey("private",msg.sender_username));}
    if(dx!==-1){dels.splice(dx,1);setDeleted(dels);}
    if(currentChat&&currentChat.type==="private"&&currentChat.name===msg.sender_username){appendBubble("other",msg.sender_username,msg.content,msg.message_type,msg.create_at,msg.id);showTyping(false);}
    loadConversations();if(!currentChat||currentChat.type!=="private"||currentChat.name!==msg.sender_username)highlightConvItem("private",0,msg.sender_username);
  }
  if(msg.type==="new_group_msg"){
    if(currentChat&&currentChat.type==="group"&&currentChat.target_id===msg.group_id)appendBubble("other",msg.sender_username,msg.content,msg.message_type,msg.create_at,msg.id);
    loadConversations();
  }
  // Group system notifications
  if(msg.type==="group_sys_notify"){
    // Show system message in group chat if viewing that group
    if(currentChat&&currentChat.type==="group"&&currentChat.target_id===msg.group_id){
      var sysMsg='[系统] '+escapeHtml(msg.desc);
      appendSystemMessage(sysMsg,msg.create_at);
    }
    loadConversations();loadGroups();
  }
}
function highlightConvItem(type,id,name){var k=convKey(type,id||name);document.querySelectorAll(".conv-item").forEach(function(it){if(it.getAttribute("data-conv-key")===k){it.classList.add("new-highlight");setTimeout(function(){it.classList.remove("new-highlight");},2000);}});}
function sendGroupNotify(notifyType,targetName,targetId,desc){
  if(!currentChat||currentChat.type!=="group")return;
  chatSocket._send({type:"group_sys_notify",group_id:currentChat.target_id,notify_type:notifyType,target_name:targetName||"",target_id:targetId||0,desc:desc||""});
}
function appendSystemMessage(desc,time){
  var list=$("messageList");var dv=document.createElement("div");dv.className="time-divider system-msg";
  dv.innerHTML="<span>"+(time?time.slice(11,16)+" ":"")+desc+"</span>";
  list.appendChild(dv);list.scrollTop=list.scrollHeight;
}

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
function applyLocalOverrides(){
  var n=getNotes(),p=getPinned(),m=getMuted(),d=getDeleted();
  cleanDeletedKeys(d);
  // 检查被清除聊天记录的会话：如果最后消息早于清除时间，清空预览
  var cleared=getChatCleared();
  convListCache.forEach(function(c){
    var ck=convKey(c.type,c.target_id);
    if(cleared[ck]&&c.last_time){
      var ct=new Date(cleared[ck]);
      var lt=new Date(c.last_time.replace(/-/g,"/"));
      if(lt<ct){c.last_msg="";c.last_time="";}
    }
  });
  convListCache=convListCache.filter(function(c){return d.indexOf(convKey(c.type,c.target_id))===-1;});
  convListCache.forEach(function(c){
    var nk=c.type==="private"?c.name:convKey("group",c.target_id);
    if(c.remark){c._note=c.remark;}else if(n[nk]){c._note=n[nk];}else{c._note=null;}
    c._pinned=p.indexOf(convKey(c.type,c.target_id))!==-1;
    c._muted=m.indexOf(convKey(c.type,c.target_id))!==-1;
  });
  convListCache.sort(function(a,b){
    if(a._pinned&&!b._pinned)return-1;if(!a._pinned&&b._pinned)return 1;
    return(b.last_time_sort||b.last_time||"0").localeCompare(a.last_time_sort||a.last_time||"0");
  });
}

function cleanDeletedKeys(d){
  for(var i=d.length-1;i>=0;i--){
    var parts=d[i].split("_");
    if(parts[0]==="private"&&parts[1]&&isNaN(parseInt(parts[1]))){
      var found=convListCache.find(function(c){return c.type==="private"&&c.name===parts[1];});
      if(found){d[i]=convKey("private",found.target_id);}
      else{d.splice(i,1);}
    }
  }
  setDeleted(d);
}
async function loadFriends(){try{var r=await FriendAPI.friendList();friendListCache=r.friend_list||[];}catch(e){}}
async function loadGroups(){try{var r=await GroupAPI.list();groupListCache=r.data||[];}catch(e){}}
async function loadApplyBadge(){try{var r=await FriendAPI.applyList(),n=(r.data||[]).length;var gi=await GroupAPI.inviteCount(),gn=gi.count||0;var total=n+gn;var p=$("plusBadge");if(p){if(total>0)p.classList.add("visible");else p.classList.remove("visible");}var fb=$("friendReqBadge");if(fb)fb.textContent=n>0?"("+n+")":"";var gb=$("groupInviteBadge");if(gb)gb.textContent=gn>0?"("+gn+")":"";}catch(e){}}

async function showFriendRequests(){
  var d=$("plusDropdown");if(d)d.classList.remove("visible");
  try{
    var r=await FriendAPI.applyList(),list=r.data||[];
    if(list.length===0){alert("暂无新朋友申请");return;}
    var c=$("applyListInline");c.innerHTML=list.map(function(a){return'<div class="apply-item-row"><div class="apply-user">'+escapeHtml(a.apply_user_name)+'</div><div style="display:flex;gap:6px;"><button class="btn-accept" onclick="handleApplyFromModal('+a.apply_id+',1);event.stopPropagation();">同意</button><button class="btn-reject" onclick="handleApplyFromModal('+a.apply_id+',0);event.stopPropagation();">拒绝</button></div></div>';}).join("");
    c.style.display="block";$("addFriendModal").classList.add("visible");
  }catch(e){alert(e);}
}
async function handleApplyFromModal(id,op){await FriendAPI.dealApply(id,op);loadFriends();loadApplyBadge();showFriendRequests();}

async function showGroupInvites(){
  var d=$("plusDropdown");if(d)d.classList.remove("visible");
  try{
    var r=await GroupAPI.inviteList(),list=r.data||[];
    var html=list.length===0?'<div style="text-align:center;color:var(--text-sub);padding:30px;">暂无群通知</div>':
      list.map(function(inv){var st=inv.can_accept?"待你确认":"等待管理员审批";var act=inv.can_accept?'<div style="display:flex;gap:6px;"><button class="btn-accept" onclick="handleInviteDeal('+inv.invite_id+',1);event.stopPropagation();">加入</button><button class="btn-reject" onclick="handleInviteDeal('+inv.invite_id+',0);event.stopPropagation();">拒绝</button></div>':'<span style="font-size:11px;color:var(--text-sub);">⏳ '+st+'</span>';return'<div class="apply-item-row"><div class="apply-user"><span>'+escapeHtml(inv.group_name)+'</span><span style="font-size:12px;color:var(--text-sub);">'+(inv.inviter_name?" 来自 "+escapeHtml(inv.inviter_name):"")+' · '+st+'</span></div>'+act+'</div>';}).join("");
    $("groupInviteContent").innerHTML=html;$("groupInviteModal").classList.add("visible");
  }catch(e){alert(e);}
}
async function handleInviteDeal(id,op){try{await GroupAPI.inviteDeal(id,op);loadGroups();loadConversations();loadApplyBadge();showGroupInvites();}catch(e){alert(e.detail||e);}}

/* ==================== 会话列表 ==================== */
function renderConversations(){
  var c=$("conversationList"),kw=($("convSearchInput")||{}).value||"",list=convListCache;
  if(kw){kw=kw.toLowerCase();list=list.filter(function(c){return(c.name||"").toLowerCase().indexOf(kw)!==-1||((c.last_msg||"").toLowerCase().indexOf(kw)!==-1);});}
  c.innerHTML=list.map(function(cn){
    var k=convKey(cn.type,cn.target_id),active=currentChat&&currentChat.target_id===cn.target_id&&currentChat.type===cn.type?" active":"";
    var avatarUrl=cn.avatar||"",avatarHtml="";
    if(avatarUrl){avatarHtml='<img src="'+escapeHtml(avatarUrl)+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentElement.textContent=\''+(cn.type==="group"?"👥":"👤")+'\';">';}
    else {avatarHtml=(cn.type==="group"?"👥":"👤");}
    return'<div class="conv-item'+active+(cn._pinned?" pinned":"")+'" onclick="openConversation(\''+cn.type+'\','+cn.target_id+',\''+escapeHtml(cn.name)+'\')" oncontextmenu="onConvContext(event,\''+cn.type+'\','+cn.target_id+',\''+escapeHtml(cn.name)+'\')" data-conv-key="'+k+'"><div class="conv-avatar'+(cn.type==="group"?" group-avatar":"")+'">'+avatarHtml+'</div><div class="conv-info"><div class="conv-name">'+(cn._pinned?"📌 ":"")+escapeHtml(cn._note||cn.name)+'</div><div class="conv-preview">'+escapeHtml(cn.last_msg||"").slice(0,40)+'</div>'+(cn.status_message&&cn.type==="private"?'<div class="conv-status">'+escapeHtml(cn.status_message)+'</div>':"")+'</div><div class="conv-meta"><div class="conv-time">'+formatWechatTime(cn.last_time)+'</div>'+(cn.unread>0?'<div class="conv-badge">'+(cn.unread>9?"9+":cn.unread)+'</div>':"")+'</div>'+(cn._muted?'<span class="dnd-icon">🔕</span>':"")+'</div>';
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
  // Display remark if available, fallback to original name
  var displayName=name;
  if(type==="private"){
    var conv = convListCache.find(function(c){ return c.type==="private" && c.name===name; });
    if(conv && conv.remark){displayName=conv.remark;}
    else if(conv && conv._note){displayName=conv._note;}
  }
  $("chatTitle").textContent=displayName;
  var sub="群聊";
  if(type==="private"){
    var friendConv = convListCache.find(function(c){ return c.type==="private" && c.name===name; });
    sub = (friendConv && friendConv.status_message) ? friendConv.status_message : "";
  }
  $("chatSubtitle").textContent=type==="group"?"群聊":sub;
  $("messageList").innerHTML="";var em=$("messageEmpty");if(em)em.style.display="none";$("chatInputBar").style.display="block";
  var moreBtn=type==="group"?'<button class="more-btn" onclick="showGroupManagePanel()">···</button>':'<button class="more-btn" onclick="showFriendProfile(\''+escapeHtml(name)+'\')">···</button>';
  $("topbarActions").innerHTML='<div class="theme-toggle" id="themeToggle" onclick="toggleTheme()">'+(getTheme()==="dark"?"☀️":"🌙")+'</div>'+moreBtn+'<div class="plus-menu-wrapper" id="plusMenuWrapper"><button class="plus-btn" id="plusBtn">+</button><span class="plus-badge" id="plusBadge"></span><div class="plus-dropdown" id="plusDropdown"><div class="plus-dropdown-item" onclick="showAddFriendModal()"><span class="plus-dropdown-icon">👤</span><span>添加好友</span></div><div class="plus-dropdown-item" onclick="showCreateGroupModal()"><span class="plus-dropdown-icon">👥</span><span>发起群聊</span></div><div class="plus-dropdown-item" onclick="showFriendRequests()"><span class="plus-dropdown-icon">👋</span><span>新朋友</span><span id="friendReqBadge" style="color:var(--unread);font-size:11px;margin-left:auto;"></span></div><div class="plus-dropdown-item" onclick="showGroupInvites()"><span class="plus-dropdown-icon">🔔</span><span>群通知</span><span id="groupInviteBadge" style="color:var(--unread);font-size:11px;margin-left:auto;"></span></div></div></div>';
  bindPlusMenu();loadApplyBadge();renderConversations();
  loadHistory().then(function(){loadConversations();});
}
async function loadHistory(){
  if(!currentChat)return;try{var res=currentChat.type==="private"?await ChatAPI.history(currentChat.name):await GroupAPI.history(currentChat.target_id),msgs=res.data||[],list=$("messageList");list.innerHTML="";var cleared=getChatCleared();var ck=convKey(currentChat.type,currentChat.target_id);var clearTime=cleared[ck]||"";if(clearTime){var ctDate=new Date(clearTime);msgs=msgs.filter(function(m){var mt=m.create_at.replace(/-/g,"/");return new Date(mt)>=ctDate;});}var em=$("messageEmpty");if(msgs.length===0){if(em)em.style.display="block";}else{if(em)em.style.display="none";}lastMsgDate=null;msgs.forEach(function(m){appendBubble((m.sender_name===myUsername)?"me":"other",m.sender_name,m.content,m.message_type,m.create_at,m.id,m.sender_avatar);});
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
function appendBubble(side,sender,content,msgType,time,msgId,senderAvatar){
  var list=$("messageList"),em=$("messageEmpty");if(em)em.style.display="none";
  if(time){try{var d=time.slice(0,10);if(lastMsgDate&&lastMsgDate!==d){var dv=document.createElement("div");dv.className="time-divider";dv.innerHTML="<span>"+(time?time.slice(0,16):"")+"</span>";list.appendChild(dv);}lastMsgDate=d;}catch(e){}}
  var row=document.createElement("div");row.className="msg-row "+side;
  var key=msgId||("k"+Date.now()+Math.random());row.setAttribute("data-msg-key",key);row.setAttribute("data-msg-id",msgId||"");row.setAttribute("data-msg-content",content||"");row.setAttribute("data-msg-time",time||"");row.setAttribute("data-msg-sender",sender||"");row.setAttribute("data-msg-type",msgType||0);
  row.addEventListener("contextmenu",function(e){onMsgContext(e,row);});

  // 对方消息头像
  if(side==="other"){
    var av=document.createElement("div");av.className="msg-sender-avatar";
    var avatarUrl=senderAvatar||getAvatarForUser(sender);
    if(avatarUrl){var aimg=document.createElement("img");aimg.src=avatarUrl;aimg.style.width="100%";aimg.style.height="100%";aimg.style.borderRadius="50%";aimg.style.objectFit="cover";aimg.onerror=function(){av.textContent=(sender||"?").charAt(0).toUpperCase();};av.appendChild(aimg);}
    else{av.textContent=(sender||"?").charAt(0).toUpperCase();}
    row.appendChild(av);
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
function getAvatarForUser(username){if(!username)return"";for(var i=0;i<convListCache.length;i++){var c=convListCache[i];if(c.type==="private"&&c.name===username&&c.avatar)return c.avatar;}return"";}

/* ==================== 消息右键菜单 ==================== */
function onMsgContext(e,row){
  if(multiSelectMode){e.preventDefault();var cb=row.querySelector(".msg-checkbox");if(cb){cb.checked=!cb.checked;if(cb.checked)multiSelected.add(row.getAttribute("data-msg-key"));else multiSelected.delete(row.getAttribute("data-msg-key"));updateMultiCount();}return;}
  e.preventDefault();
  contextMsgData={key:row.getAttribute("data-msg-key"),id:row.getAttribute("data-msg-id"),content:row.getAttribute("data-msg-content"),time:row.getAttribute("data-msg-time"),sender:row.getAttribute("data-msg-sender"),msgType:parseInt(row.getAttribute("data-msg-type"))||0,chatWith:currentChat?currentChat.name:"",chatType:currentChat?currentChat.type:""};
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
var _fpTargetName = "";
var _fpTargetData = null;

async function showFriendProfile(name) {
  _fpTargetName = name;
  _fpTargetData = null;
  $("fpRemarkEditArea").style.display = "none";

  try {
    var r = await FriendAPI.profile(name);
    if (r.code !== 200) { alert(r.detail || "获取资料失败"); return; }
    _fpTargetData = r.data;

    if (_fpTargetData.avatar) {
      $("fpAvatarImg").src = _fpTargetData.avatar;
      $("fpAvatarImg").style.display = "block";
      $("fpAvatarFallback").style.display = "none";
    } else {
      $("fpAvatarImg").style.display = "none";
      $("fpAvatarFallback").style.display = "flex";
      $("fpAvatarFallback").textContent = (_fpTargetData.username || "?").charAt(0).toUpperCase();
    }
    $("fpUsername").textContent = _fpTargetData.username;
    $("fpRoleBadge").textContent = "";

    if (_fpTargetData.remark) {
      $("fpRemarkValue").textContent = _fpTargetData.remark;
    } else {
      $("fpRemarkValue").textContent = "未设置";
    }

    var online = _fpTargetData.is_online;
    var dot = $("fpOnlineDot"), text = $("fpOnlineText");
    if (dot) dot.style.background = online ? "var(--green)" : "#ccc";
    if (text) text.textContent = online ? "在线" : "离线";
    $("fpStatusMsg").textContent = _fpTargetData.status_message || "未设置";
    $("fpAccountId").textContent = _fpTargetData.user_id;

    try {
      var mr = await FriendAPI.getMute(name);
      var mb = $("fpMuteBtn");
      if (mr.is_muted === 1) { mb.textContent = "🔔 关闭免打扰"; mb._muted = true; }
      else { mb.textContent = "🔕 消息免打扰"; mb._muted = false; }
    } catch (e) { $("fpMuteBtn")._muted = false; }
  } catch (e) {
    // Fallback: show from local caches
    $("fpAvatarFallback").textContent = (name || "?").charAt(0).toUpperCase();
    $("fpUsername").textContent = name;
    var notes = getNotes();
    $("fpRemarkValue").textContent = notes[name] || "未设置";
    $("fpOnlineText").textContent = "未知";
    $("fpStatusMsg").textContent = "";
    var conv = convListCache.find(function (c) { return c.type === "private" && c.name === name; });
    $("fpAccountId").textContent = conv ? conv.target_id : "---";
  }

  $("friendProfileModal").classList.add("visible");
}

function fpEditRemark() {
  $("fpRemarkEditArea").style.display = "block";
  $("fpRemarkInput").value = (_fpTargetData && _fpTargetData.remark) || "";
  $("fpRemarkInput").focus();
}

async function fpSaveRemark() {
  var remark = $("fpRemarkInput").value.trim();
  if (remark.length > 12) { alert("备注最多12个字"); return; }
  try {
    var r = await FriendAPI.setRemark(_fpTargetName, remark);
    if (r.code === 200) {
      $("fpRemarkValue").textContent = remark || "未设置";
      $("fpRemarkEditArea").style.display = "none";
      if (_fpTargetData) _fpTargetData.remark = remark;
      loadConversations();
    }
  } catch (e) { alert("设置失败"); }
}

function fpSendMsg() { closeModal("friendProfileModal"); var tid = (_fpTargetData && _fpTargetData.user_id) || 0; openConversation("private", tid, _fpTargetName); }
function fpSendFile() { closeModal("friendProfileModal"); var tid = (_fpTargetData && _fpTargetData.user_id) || 0; openConversation("private", tid, _fpTargetName); document.getElementById("fileInput").click(); }

async function fpToggleMute() {
  var btn = $("fpMuteBtn"); var newMuted = !btn._muted;
  try {
    var r = await FriendAPI.setMute(_fpTargetName, newMuted);
    if (r.code === 200) { btn._muted = newMuted; btn.textContent = newMuted ? "🔔 关闭免打扰" : "🔕 消息免打扰"; }
  } catch (e) { alert("操作失败"); }
}

function getChatCleared(){try{return JSON.parse(localStorage.getItem("chat_cleared"))||{};}catch(e){return{};}}
function setChatCleared(v){localStorage.setItem("chat_cleared",JSON.stringify(v));}
function fpClearChat() {
  if (!confirm("确定清空与「" + _fpTargetName + "」的聊天记录？此操作不可恢复。")) return;
  var targetId = (_fpTargetData && _fpTargetData.user_id) || _fpTargetName;
  var k = convKey("private", targetId);
  var cleared = getChatCleared();
  cleared[k] = new Date().toISOString();
  setChatCleared(cleared);
  $("messageList").innerHTML = ""; var em = $("messageEmpty"); if (em) em.style.display = "block";
  if (currentChat && currentChat.type === "private" && currentChat.name === _fpTargetName) {
    // 更新缓存中的 last_msg 为空
    convListCache.forEach(function(c){ if (c.type === "private" && c.name === _fpTargetName) { c.last_msg = ""; c.last_time = ""; } });
  }
  renderConversations();
}

async function fpDeleteFriend() {
  if (!confirm("确定删除好友「" + _fpTargetName + "」？此操作不可撤销。")) return;
  try {
    var r = await FriendAPI.deleteFriend(_fpTargetName);
    if (r.code === 200) {
      closeModal("friendProfileModal"); loadFriends(); loadConversations();
      if (currentChat && currentChat.type === "private" && currentChat.name === _fpTargetName) { currentChat = null; resetChatView(); }
    }
  } catch (e) { alert("删除失败"); }
}
var _muteTargetUid = null; var _muteTargetName = "";
var _gpMemberListVisible = true;

/* ==================== 群管理面板（redesigned） ==================== */
async function showGroupManagePanel() {
  if (!currentChat || currentChat.type !== "group") return;

  var r = await GroupAPI.members(currentChat.target_id);
  if (!r || r.code !== 200) {
    alert(r && r.detail ? r.detail : "获取群信息失败，请稍后重试");
    return;
  }
  var members = r.data || [];
  var myRole = r.my_role || "member";
  var isOwner = myRole === "owner";
  var isAdmin = isOwner || myRole === "admin";

  // Find group info from cache
  var groupInfo = null;
  groupListCache.forEach(function (g) { if (g.group_id === currentChat.target_id) groupInfo = g; });

  $("groupPanelTitle").textContent = "群管理";
  var html = "";

  // === TOP INFO SECTION ===
  var avatarUrl = (groupInfo && groupInfo.avatar) || "";
  html += '<div class="gp-top-section">';
  if (avatarUrl) {
    html += '<img src="' + escapeHtml(avatarUrl) + '" class="gp-avatar" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
    html += '<div class="gp-avatar gp-avatar-fallback" style="display:none;">' + (currentChat.name || "?").charAt(0).toUpperCase() + '</div>';
  } else {
    html += '<div class="gp-avatar-fallback">' + (currentChat.name || "?").charAt(0).toUpperCase() + '</div>';
  }
  html += '<div class="gp-name">' + escapeHtml(currentChat.name) + '</div>';
  html += '<div class="gp-announce-preview" id="gpAnnouncePreview">加载中…</div>';
  html += '</div>';

  // === ADMIN BUTTONS ===
  if (isAdmin) {
    html += '<div class="gp-admin-buttons">';
    html += '<button class="gp-btn" onclick="gpEditGroupName()">✏️ 修改群名称</button>';
    html += '<button class="gp-btn" onclick="gpChangeAvatar()">🖼️ 更换群头像</button>';
    html += '<input type="file" id="gpAvatarInput" accept="image/jpeg,image/png" style="display:none" onchange="gpUploadAvatar(event)">';
    html += '<button class="gp-btn" onclick="gpEditAnnouncement()">📢 编辑群公告</button>';
    html += '<button class="gp-btn" onclick="gpToggleMemberList()">👥 群成员管理 (' + members.length + '人)</button>';
    var cachedJoinMode = (groupInfo && groupInfo.join_mode !== undefined) ? groupInfo.join_mode : 1;
    html += '<div class="gp-func-row" style="padding:8px 0;font-size:13px;">🔐 入群验证 <label class="toggle-switch" style="margin-left:auto;"><input type="checkbox" id="gpJoinModeToggle" onchange="gpToggleJoinMode(this.checked)"' + (cachedJoinMode === 1 ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>';
    html += '</div>';
  }

  // === MEMBER LIST (collapsible) ===
  html += '<div class="gp-member-section" id="gpMemberSection" style="' + (isAdmin ? 'display:none;' : '') + '">';
  html += '<div class="gp-member-header">👥 群成员 (' + members.length + '人)</div>';
  html += '<div id="gpMemberList">';
  members.forEach(function (m) {
    var roleIcon = m.role === "owner" ? "👑" : m.role === "admin" ? "🛡️" : "";
    var mutedBadge = m.is_muted ? ' 🔇' : '';
    html += '<div class="member-item" style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">';
    html += '<div style="display:flex;align-items:center;gap:8px;cursor:pointer;" ondblclick="closeModal(\'groupManagePanel\');openConversation(\'private\',0,\'' + escapeHtml(m.username) + '\');">';
    html += '<div class="member-avatar" style="width:32px;height:32px;border-radius:50%;background:var(--bg-hover);display:flex;align-items:center;justify-content:center;font-size:14px;">' + (m.username || "?").charAt(0).toUpperCase() + '</div>';
    html += '<span style="font-size:14px;">' + roleIcon + ' ' + escapeHtml(m.username) + mutedBadge + '</span></div>';
    // Only show action buttons for OTHER members when current user is admin
    var isSelf = myUserId ? (m.user_id === myUserId) : (m.username === myUsername);
    if (!isSelf && isAdmin) {
      html += '<div style="display:flex;gap:4px;">';
      if (m.role === "member") {
        if (!m.is_muted) { html += '<button class="btn-mini" onclick="openMuteModal(' + m.user_id + ',\'' + escapeHtml(m.username) + '\')" title="禁言">🔇</button>'; }
        else { html += '<button class="btn-mini" onclick="unmuteMember(' + m.user_id + ',\'' + escapeHtml(m.username) + '\')" title="解除禁言">🔊</button>'; }
        html += '<button class="btn-mini" style="color:var(--red);" onclick="kickMember(' + m.user_id + ',\'' + escapeHtml(m.username) + '\')" title="移出群聊">✕</button>';
        if (isOwner) { html += '<button class="btn-mini" style="color:var(--green);" onclick="setAdmin(' + m.user_id + ',\'' + escapeHtml(m.username) + '\')" title="设为管理员">🛡️</button>'; }
      }
      if (m.role === "admin" && isOwner) {
        html += '<button class="btn-mini" style="color:var(--red);" onclick="revokeAdmin(' + m.user_id + ',\'' + escapeHtml(m.username) + '\')" title="撤销管理员">⬇</button>';
        html += '<button class="btn-mini" style="color:var(--green);" onclick="openTransferModal(' + m.user_id + ',\'' + escapeHtml(m.username) + '\')" title="转让群主">👑</button>';
      }
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div></div>';

  // === ALL-MEMBER FUNCTIONS ===
  html += '<div class="gp-functions" style="border-top:1px solid var(--border);margin-top:12px;padding-top:8px;">';
  if (!isAdmin) {
    html += '<div class="gp-func-item" onclick="gpToggleMemberList()">👥 查看群成员</div>';
  }
  html += '<div class="gp-func-item gp-func-row">🔕 消息免打扰 <label class="toggle-switch" style="margin-left:auto;"><input type="checkbox" id="gpMuteToggle" onchange="gpToggleGroupMute(this.checked)"><span class="toggle-slider"></span></label></div>';
  html += '<div class="gp-func-item" onclick="closeModal(\'groupManagePanel\');showInviteToGroupModal()">➕ 邀请好友入群</div>';
  html += '<div class="gp-func-item" onclick="gpClearLocalChat()">🗑 清空本地聊天记录</div>';
  html += '<div class="gp-func-item" onclick="closeModal(\'groupManagePanel\');showGroupEvents()">📜 群事件日志</div>';
  if (isAdmin) {
    html += '<div class="gp-func-item" onclick="gpShowGroupAnnouncement()">📢 查看群公告</div>';
  }
  if (isOwner) {
    html += '<div class="gp-func-item" onclick="closeModal(\'groupManagePanel\');showJoinRequests()">📩 入群申请</div>';
    html += '<div class="gp-func-item" style="color:var(--red);" onclick="disbandGroup()">💥 解散群聊</div>';
  } else {
    html += '<div class="gp-func-item" style="color:var(--red);" onclick="leaveCurrentGroup()">🚪 退出群聊</div>';
  }
  html += '</div>';

  $("groupPanelContent").innerHTML = html;
  $("groupManagePanel").classList.add("visible");

  // Load announcement preview
  try {
    var ar = await GroupAPI.announcement(currentChat.target_id);
    if (ar.code === 200 && ar.data && ar.data.announcement) {
      var firstLine = ar.data.announcement.split("\n")[0];
      var el3 = $("gpAnnouncePreview"); if (el3) el3.textContent = "📢 " + (firstLine.length > 30 ? firstLine.slice(0, 30) + "…" : firstLine);
    } else {
      var el4 = $("gpAnnouncePreview"); if (el4) el4.textContent = "暂无公告";
    }
  } catch (e) { var el5 = $("gpAnnouncePreview"); if (el5) el5.textContent = "暂无公告"; }

  // Load mute state
  try {
    var mr = await GroupAPI.getMuteSetting(currentChat.target_id);
    var toggle = $("gpMuteToggle"); if (toggle) toggle.checked = mr.is_muted === 1;
  } catch (e) { }

  _gpMemberListVisible = !isAdmin; // non-admin: member list visible by default
}

// ---------- Group panel helpers ----------

function gpEditGroupName() {
  var nameDiv = document.querySelector(".gp-name");
  var currentName = currentChat.name;
  nameDiv.innerHTML = '<input type="text" id="gpNameInput" maxlength="20" value="' + escapeHtml(currentName) + '" style="font-size:16px;font-weight:500;text-align:center;border:1.5px solid var(--green);border-radius:6px;padding:4px 8px;width:200px;background:var(--bg-card);color:var(--text-main);" onblur="gpSaveGroupName()" onkeydown="if(event.key===\'Enter\')gpSaveGroupName()">';
  var inp = $("gpNameInput"); if (inp) { inp.focus(); inp.select(); }
}

async function gpSaveGroupName() {
  var inp = $("gpNameInput");
  var newName = (inp && inp.value.trim()) || "";
  if (!newName || newName === currentChat.name) { showGroupManagePanel(); return; }
  var r = await GroupAPI.update(currentChat.target_id, { group_name: newName });
  if (r.code === 200) {
    currentChat.name = newName;
    $("chatTitle").textContent = newName;
    sendGroupNotify("rename", "", 0, myUsername + " 修改了群名称为 " + newName);
    loadGroups(); loadConversations(); showGroupManagePanel();
  } else { alert(r.detail || "修改失败"); showGroupManagePanel(); }
}

function gpChangeAvatar() { var inp = $("gpAvatarInput"); if (inp) inp.click(); }

async function gpUploadAvatar(e) {
  var file = e.target.files[0]; if (!file) return; e.target.value = "";
  if (!file.type.match(/^image\/(jpeg|png)$/)) { alert("仅支持JPG/PNG"); return; }
  if (file.size > 10 * 1024 * 1024) { alert("最大10MB"); return; }
  var res = await apiUpload(file);
  if (res.code !== 200) { alert(res.detail || "上传失败"); return; }
  var r = await GroupAPI.update(currentChat.target_id, { avatar: res.file_url });
  if (r.code === 200) { sendGroupNotify("avatar","",0,myUsername+" 更换了群头像"); loadGroups(); showGroupManagePanel(); }
  else { alert(r.detail || "更新头像失败"); }
}

async function gpEditAnnouncement() {
  try {
    var ar = await GroupAPI.announcement(currentChat.target_id);
    $("announcementEditText").value = (ar.data && ar.data.announcement) || "";
  } catch (e) { $("announcementEditText").value = ""; }
  $("announcementEditModal").classList.add("visible");
}

async function saveAnnouncement() {
  var text = $("announcementEditText").value.trim();
  var r = await GroupAPI.update(currentChat.target_id, { announcement: text });
  if (r.code === 200) {
    sendGroupNotify("announcement", "", 0, myUsername + " 更新了群公告");
    closeModal("announcementEditModal"); showGroupManagePanel();
  } else { alert(r.detail || "保存失败"); }
}

function gpToggleMemberList() {
  _gpMemberListVisible = !_gpMemberListVisible;
  var section = $("gpMemberSection"); if (section) section.style.display = _gpMemberListVisible ? "block" : "none";
}

async function gpToggleJoinMode(checked) {
  var mode = checked ? 1 : 0;
  var r = await GroupAPI.joinMode(currentChat.target_id, mode);
  if (r.code === 200) {
    groupListCache.forEach(function(g) { if (g.group_id === currentChat.target_id) g.join_mode = mode; });
  } else { alert(r.detail || "设置失败"); showGroupManagePanel(); }
}

async function showInviteToGroupModal() {
  try {
    var r = await GroupAPI.invitableFriends(currentChat.target_id);
    var friends = r.data || [];
    var cc = $("inviteMemberCheckboxes");
    cc.innerHTML = friends.length === 0
      ? '<div style="color:var(--text-sub);padding:12px;text-align:center;">暂无可邀请的好友</div>'
      : friends.map(function(f) {
          return '<label class="modal-check-item"><input type="checkbox" value="' + escapeHtml(f.username) + '" class="invite-member-check"> ' + escapeHtml(f.username) + '</label>';
        }).join("");
    $("inviteToGroupModal").classList.add("visible");
  } catch(e) { alert("获取可邀请好友列表失败"); }
}

async function inviteToGroup() {
  var sel = [];
  document.querySelectorAll(".invite-member-check:checked").forEach(function(cb) { sel.push(cb.value); });
  if (sel.length === 0) { alert("请至少选择一个好友"); return; }
  var success = 0, fail = 0;
  for (var i = 0; i < sel.length; i++) {
    try {
      var r = await GroupAPI.invite(currentChat.target_id, sel[i]);
      if (r.code === 200) { success++; }
      else { fail++; }
    } catch(e) { fail++; }
  }
  alert("成功邀请 " + success + " 人" + (fail > 0 ? "，" + fail + " 人失败" : ""));
  closeModal("inviteToGroupModal");
  showGroupManagePanel();
  loadGroups();
}

async function gpToggleGroupMute(muted) {
  await GroupAPI.muteSetting(currentChat.target_id, muted);
  loadConversations();
}

function gpClearLocalChat() {
  if (!confirm("确定清空本地聊天记录？此操作不可恢复。")) return;
  var k = convKey("group", currentChat.target_id);
  var cleared = getChatCleared();
  cleared[k] = new Date().toISOString();
  setChatCleared(cleared);
  $("messageList").innerHTML = ""; var em = $("messageEmpty"); if (em) em.style.display = "block";
  convListCache.forEach(function(c){ if (c.type === "group" && c.target_id === currentChat.target_id) { c.last_msg = ""; c.last_time = ""; } });
  renderConversations();
}

async function gpShowGroupAnnouncement() {
  var r = await GroupAPI.announcement(currentChat.target_id);
  var ann = (r.data && r.data.announcement) || "暂无公告";
  $("groupPanelContent").innerHTML = '<div style="padding:10px;"><div style="font-size:13px;color:var(--text-sub);margin-bottom:8px;">📢 群公告</div><div style="background:var(--bg-hover);padding:12px;border-radius:8px;font-size:14px;white-space:pre-wrap;">' + escapeHtml(ann) + '</div><button class="btn-full light" onclick="showGroupManagePanel()" style="margin-top:12px;">← 返回</button></div>';
  $("groupManagePanel").classList.add("visible");
}

function openMuteModal(uid,name){_muteTargetUid=uid;_muteTargetName=name;$("muteTargetInfo").textContent="对 "+name+" 设置禁言";$("groupManagePanel").classList.remove("visible");$("muteDurationModal").classList.add("visible");}
async function doMuteMember(duration){if(!_muteTargetUid||!currentChat)return;
  var r=await GroupAPI.mute(currentChat.target_id,_muteTargetUid,duration);if(r.code===200){alert(r.msg);var durMap={};durMap["5m"]="5分钟";durMap["30m"]="30分钟";durMap["2h"]="2小时";durMap["forever"]="永久";sendGroupNotify("mute",_muteTargetName,_muteTargetUid,myUsername+" 将 "+_muteTargetName+" 禁言（"+durMap[duration]+"）");}else{alert(r.detail||"失败");}
  $("muteDurationModal").classList.remove("visible");showGroupManagePanel();}
async function unmuteMember(uid,name){if(!confirm("解除 "+name+" 的禁言？"))return;
  var r=await GroupAPI.unmute(currentChat.target_id,uid);if(r.code===200){alert(r.msg);sendGroupNotify("unmute",name,uid,myUsername+" 解除了 "+name+" 的禁言");showGroupManagePanel();}else{alert(r.detail||"失败");}}
async function kickMember(uid,name){if(!confirm("确定将 "+name+" 移出群聊？"))return;
  var r=await GroupAPI.kick(currentChat.target_id,uid);if(r.code===200){alert(r.msg);sendGroupNotify("kick",name,uid,myUsername+" 将 "+name+" 移出群聊");showGroupManagePanel();loadConversations();}else{alert(r.detail||"失败");}}
async function setAdmin(uid,name){if(!confirm("确定将 "+name+" 设为管理员？"))return;
  var r=await GroupAPI.setAdmin(currentChat.target_id,uid);if(r.code===200){alert(r.msg);sendGroupNotify("set_admin",name,uid,myUsername+" 将 "+name+" 设为管理员");showGroupManagePanel();}else{alert(r.detail||"失败");}}
async function revokeAdmin(uid,name){if(!confirm("确定撤销 "+name+" 的管理员权限？"))return;
  var r=await GroupAPI.revokeAdmin(currentChat.target_id,uid);if(r.code===200){alert(r.msg);sendGroupNotify("revoke_admin",name,uid,myUsername+" 撤销了 "+name+" 的管理员权限");showGroupManagePanel();}else{alert(r.detail||"失败");}}

async function openTransferModal(uid,name){
  $("groupManagePanel").classList.remove("visible");$("transferOwnerModal").classList.add("visible");
  $("transferCandidateList").innerHTML='<div style="text-align:center;padding:20px;"><p>将群主转让给 <b>'+escapeHtml(name)+'</b>？</p><p style="font-size:12px;color:var(--text-sub);">转让后你将降级为管理员</p><div style="margin-top:12px;display:flex;gap:8px;justify-content:center;"><button class="btn-confirm" onclick="doTransferOwner('+uid+')">确认转让</button><button class="btn-cancel" onclick="closeModal(\'transferOwnerModal\');showGroupManagePanel()">取消</button></div></div>';
}
async function doTransferOwner(newUid){if(!currentChat)return;
  var r=await GroupAPI.transfer(currentChat.target_id,newUid);if(r.code===200){alert(r.msg);sendGroupNotify("transfer_owner","",newUid,myUsername+" 将群主转让了");closeModal("transferOwnerModal");loadGroups();loadConversations();currentChat=null;resetChatView();}else{alert(r.detail||"失败");}}

async function disbandGroup(){if(!currentChat||currentChat.type!=="group")return;if(!confirm("⚠️ 确定解散群聊？此操作不可撤销！"))return;
  var r=await GroupAPI.disband(currentChat.target_id);if(r.code===200){alert(r.msg);sendGroupNotify("disband","",0,myUsername+" 解散了群聊");currentChat=null;resetChatView();loadConversations();loadGroups();}else{alert(r.detail||"失败");}}

async function showEditGroupModal(){
  var r=await GroupAPI.members(currentChat.target_id),ms=r.data||[],groupName=currentChat.name;
  groupListCache.forEach(function(g){if(g.group_id===currentChat.target_id)groupName=g.group_name;});
  $("editGroupName").value=groupName;$("editGroupAnnouncement").value="";$("editJoinMode").value="1";
  try{var ar=await GroupAPI.announcement(currentChat.target_id);if(ar.code===200)$("editGroupAnnouncement").value=ar.data.announcement||"";}catch(e){}
  $("editGroupModal").classList.add("visible");
}
async function saveGroupInfo(){
  var name=$("editGroupName").value.trim(),ann=$("editGroupAnnouncement").value.trim(),jm=parseInt($("editJoinMode").value);
  var data={};if(name)data.group_name=name;data.announcement=ann;data.join_mode=jm;
  var r=await GroupAPI.update(currentChat.target_id,data);if(r.code===200){alert(r.msg);if(name)sendGroupNotify("rename","",0,myUsername+" 修改了群名称为 "+name);if(ann)sendGroupNotify("announcement","",0,myUsername+" 更新了群公告");closeModal("editGroupModal");loadGroups();loadConversations();}else{alert(r.detail||"失败");}
}

async function showGroupAnnouncement(){
  var r=await GroupAPI.announcement(currentChat.target_id);
  $("groupPanelContent").innerHTML='<div style="padding:10px;"><div style="font-size:13px;color:var(--text-sub);margin-bottom:8px;">📢 群公告</div><div style="background:var(--bg-hover);padding:12px;border-radius:8px;font-size:14px;white-space:pre-wrap;">'+escapeHtml((r.data&&r.data.announcement)||"暂无公告")+'</div></div>';
  $("groupManagePanel").classList.add("visible");
}

async function showGroupEvents(){
  var r=await GroupAPI.events(currentChat.target_id),evs=r.data||[];
  $("groupPanelContent").innerHTML='<div style="padding:10px;"><div style="font-size:13px;color:var(--text-sub);margin-bottom:8px;">📜 群事件日志</div>'+evs.map(function(e){return'<div style="font-size:12px;padding:4px 0;color:var(--text-sub);">['+e.create_at+'] '+escapeHtml(e.desc)+'</div>';}).join("")+(evs.length===0?'<div style="color:var(--text-sub);text-align:center;padding:20px;">暂无事件</div>':'')+'</div>';
  $("groupManagePanel").classList.add("visible");
}

async function showJoinRequests(){
  var r=await GroupAPI.applyList(currentChat.target_id),reqs=r.data||[];
  $("joinRequestsList").innerHTML=reqs.length===0?'<div style="text-align:center;color:var(--text-sub);padding:16px;">暂无申请</div>':reqs.map(function(jr){return'<div class="apply-item-row"><span>👤 '+escapeHtml(jr.applicant_name)+'</span><span style="display:flex;gap:6px;"><button class="btn-accept" onclick="handleGroupApply('+jr.request_id+',1)">同意</button><button class="btn-reject" onclick="handleGroupApply('+jr.request_id+',0)">拒绝</button></span></div>';}).join("");
  $("joinRequestsModal").classList.add("visible");
}
window.handleGroupApply=async function(rid,op){
  var r=await GroupAPI.dealApply(rid,op);if(r.code===200){alert(r.msg);}else{alert(r.detail||"失败");}
  closeModal("joinRequestsModal");loadGroups();loadConversations();
};
function showAddFriendModal(){var d=$("plusDropdown");if(d)d.classList.remove("visible");$("friendSearchInput").value="";$("searchResult").innerHTML="";$("applyListInline").style.display="none";$("addFriendModal").classList.add("visible");}
async function onSearchUser(){var kw=$("friendSearchInput").value.trim();if(kw.length<1){$("searchResult").innerHTML="";return;}var r=await FriendAPI.search(kw),d=r.data||[];$("searchResult").innerHTML=d.map(function(u){return'<div class="search-item" onclick="$(\'friendSearchInput\').value=\''+escapeHtml(u.username)+'\'">👤 '+escapeHtml(u.username)+(u.is_friend?' <span style="color:var(--green);font-size:12px;">(已是好友)</span>':'')+'</div>';}).join("");}
async function addFriend(){var n=$("friendSearchInput").value.trim();if(!n){alert("请先搜索");return;}if(!confirm("发送好友申请给「"+n+"」？"))return;await FriendAPI.apply(n);loadFriends();loadApplyBadge();}
async function showApplyListInModal(){var c=$("applyListInline"),r=await FriendAPI.applyList(),d=r.data||[];c.innerHTML=d.length===0?'<div style="text-align:center;color:var(--text-sub);padding:16px 0;">暂无</div>':d.map(function(a){return'<div class="apply-item-row"><span class="apply-user">👤 '+escapeHtml(a.apply_user_name)+'</span><span style="display:flex;gap:6px;"><button class="btn-accept" onclick="handleApply('+a.apply_id+',1)">同意</button><button class="btn-reject" onclick="handleApply('+a.apply_id+',0)">拒绝</button></span></div>';}).join("");c.style.display="block";}
window.handleApply=async function(id,op){await FriendAPI.dealApply(id,op);loadFriends();loadApplyBadge();showApplyListInModal();};
function showCreateGroupModal(){var d=$("plusDropdown");if(d)d.classList.remove("visible");var cc=$("groupMemberCheckboxes");cc.innerHTML=friendListCache.length===0?'<div style="color:var(--text-sub);">暂无好友</div>':friendListCache.map(function(n){return'<label class="modal-check-item"><input type="checkbox" value="'+escapeHtml(n)+'" class="member-check"> '+escapeHtml(n)+'</label>';}).join("");$("newGroupName").value="";$("createGroupModal").classList.add("visible");}
async function createGroup(){var n=$("newGroupName").value.trim(),sel=[];document.querySelectorAll(".member-check:checked").forEach(function(cb){sel.push(cb.value);});var r=await GroupAPI.create(n);if(r.code!==200){alert(r.detail||"失败");return;}for(var i=0;i<sel.length;i++)await GroupAPI.invite(r.group_id,sel[i]);$("createGroupModal").classList.remove("visible");loadGroups();loadConversations();}
async function leaveCurrentGroup(){if(!currentChat||currentChat.type!=="group")return;if(!confirm("确定退出？"))return;await GroupAPI.leave(currentChat.target_id);currentChat=null;resetChatView();loadConversations();loadGroups();}
function resetChatView(){$("chatTitle").textContent="欢迎";$("chatSubtitle").textContent="";$("messageList").innerHTML='<div class="message-empty" id="messageEmpty"><div class="empty-icon">💬</div><div class="empty-text">选择左侧会话开始聊天</div><div class="empty-sub">好友消息、群聊消息都在这里<br>开启你的数字方舟之旅 ✨</div></div>';$("messageEmpty").style.display="block";$("chatInputBar").style.display="none";$("topbarActions").innerHTML='<div class="theme-toggle" id="themeToggle" onclick="toggleTheme()">'+(getTheme()==="dark"?"☀️":"🌙")+'</div><div class="plus-menu-wrapper" id="plusMenuWrapper"><button class="plus-btn" id="plusBtn">+</button><span class="plus-badge" id="plusBadge"></span><div class="plus-dropdown" id="plusDropdown"><div class="plus-dropdown-item" onclick="showAddFriendModal()"><span class="plus-dropdown-icon">👤</span><span>添加好友</span></div><div class="plus-dropdown-item" onclick="showCreateGroupModal()"><span class="plus-dropdown-icon">👥</span><span>发起群聊</span></div><div class="plus-dropdown-item" onclick="showFriendRequests()"><span class="plus-dropdown-icon">👋</span><span>新朋友</span><span id="friendReqBadge" style="color:var(--unread);font-size:11px;margin-left:auto;"></span></div><div class="plus-dropdown-item" onclick="showGroupInvites()"><span class="plus-dropdown-icon">🔔</span><span>群通知</span><span id="groupInviteBadge" style="color:var(--unread);font-size:11px;margin-left:auto;"></span></div></div></div>';bindPlusMenu();loadApplyBadge();}

/* ==================== 表情 ==================== */
function buildEmojiPanel(){var p=$("emojiPanel");if(!p)return;p.innerHTML="";
  // "+" custom emoji button at position 1
  var addBtn=document.createElement("span");addBtn.className="emoji-item emoji-add-btn";addBtn.textContent="+";addBtn.title="上传自定义表情";addBtn.onclick=function(e){e.stopPropagation();document.getElementById("customEmojiInput").click();};p.appendChild(addBtn);
  // All system emojis
  var list=buildEmojiList();var added=new Set();
  for(var i=0;i<list.length;i++){var item=list[i];if(added.has(item.mark))continue;added.add(item.mark);
    var s=document.createElement("span");s.className="emoji-item";
    if(item.custom){var img=document.createElement("img");img.src=item.emoji;img.style.width="28px";img.style.height="28px";img.style.objectFit="cover";img.style.borderRadius="4px";s.appendChild(img);s.title="自定义表情";}
    else {s.textContent=item.emoji;s.title=item.mark;}
    s.onclick=(function(m){return function(){$("msgInput").value+=m;p.classList.remove("visible");};})(item.mark);
    p.appendChild(s);
  }
}
async function onCustomEmojiSelect(e){var f=e.target.files[0];if(!f)return;e.target.value="";if(!f.type.match(/^image\/(jpeg|png)$/)){alert("仅支持JPG/PNG格式");return;}if(f.size>2*1024*1024){alert("表情最大2MB");return;}var res=await apiUpload(f);if(res.code!==200){alert(res.detail||"上传失败");return;}var mark="[图片表情]";var custom=getCustomEmojis();custom.push({mark:mark,emoji:res.file_url});saveCustomEmojis(custom);buildEmojiPanel();}
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
