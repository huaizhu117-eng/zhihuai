import { getContext } from "../../../extensions.js";
import { getRequestHeaders } from "../../../../script.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";

// ============ 工具函数 ============

function parseDate(dateStr) {
    if (!dateStr) return null;
    let d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    if (window.moment) {
        const m = window.moment(dateStr);
        if (m.isValid()) return m.toDate();
    }
    return null;
}

function formatDate(d) {
    if (!d) return "未知";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let lastStats = null;
let lastCharacter = null;

function getPersonaChoice(character) {
    if (!character) return null;
    try {
        return localStorage.getItem(`cs-persona-${character.avatar}`);
    } catch (e) {
        return null;
    }
}

function setPersonaChoice(character, avatarFile) {
    if (!character) return;
    try {
        localStorage.setItem(`cs-persona-${character.avatar}`, avatarFile);
    } catch (e) {}
}

function getUserAvatarSrc(character) {
    // 优先从当前页面已经渲染出来的用户消息头像里拿（在聊天里点的时候最准确）
    const img = $('.mes[is_user="true"] .avatar img').first();
    if (img.length && img.attr("src")) return img.attr("src");

    // 之前手动为这个角色选过的头像
    const chosen = getPersonaChoice(character);
    if (chosen) return `/User Avatars/${encodeURIComponent(chosen)}`;

    // 没选过就用默认persona兜底
    const context = getContext();
    const defaultPersona = context.powerUserSettings?.default_persona;
    if (defaultPersona) {
        return `/User Avatars/${encodeURIComponent(defaultPersona)}`;
    }

    return "";
}

function computeLongestStreak(daySet) {
    if (daySet.size === 0) return 0;
    const days = Array.from(daySet)
        .map((d) => new Date(d))
        .sort((a, b) => a - b);

    let longest = 1;
    let current = 1;
    for (let i = 1; i < days.length; i++) {
        const diffDays = Math.round((days[i] - days[i - 1]) / 86400000);
        if (diffDays === 1) {
            current++;
            longest = Math.max(longest, current);
        } else if (diffDays > 1) {
            current = 1;
        }
    }
    return longest;
}

function buildStats(chatArray, character) {
    let userMsgCount = 0;
    let charMsgCount = 0;
    let totalChars = 0;
    const daySet = new Set();
    let firstDate = null;
    let lastDate = null;

    let skippedNoMes = 0;
    let skippedSystem = 0;
    let counted = 0;

    for (const msg of chatArray) {
        if (!msg || typeof msg.mes !== "string") {
            skippedNoMes++;
            continue;
        }

        counted++;

        if (msg.is_user) userMsgCount++;
        else charMsgCount++;

        totalChars += msg.mes.length;

        const msgDate = parseDate(msg.send_date);
        if (msgDate) {
            daySet.add(msgDate.toDateString());
            if (!firstDate || msgDate < firstDate) firstDate = msgDate;
            if (!lastDate || msgDate > lastDate) lastDate = msgDate;
        }
    }

    const charAvatar = character
        ? `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`
        : "";
    const userAvatar = getUserAvatarSrc(character);

    return {
        companionDays: daySet.size,
        longestStreak: computeLongestStreak(daySet),
        totalMessages: userMsgCount + charMsgCount,
        totalChars,
        firstDate,
        lastDate,
        userAvatar,
        charAvatar,
        charName: character ? character.name : "未知角色",
        debugCounts: `原始${chatArray.length}条 → 无mes跳过${skippedNoMes} / 系统消息跳过${skippedSystem} / 计入${counted}`,
    };
}

// ============ 弹窗渲染 ============

function renderStatsPopup(stats) {
    $("#extensionsMenu").hide();
    lastStats = stats;

    const wanZi = (stats.totalChars / 10000).toFixed(1);

    const html = `
      <div id="chat-stats-modal">
        <div class="cs-title">${stats.charName}<span class="cs-author-icon">🕷️</span></div>
        <div class="cs-avatars" style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:14px;">
            <img class="cs-avatar" src="${stats.userAvatar}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;background:#eee;" onerror="this.style.visibility='hidden'"/>
            <span class="cs-heart">⚡</span>
            <img class="cs-avatar" src="${stats.charAvatar}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;background:#eee;" onerror="this.style.visibility='hidden'"/>
        </div>
        <div class="cs-cycle-avatar">🔄换头像</div>
        <div class="cs-avatar-picker" style="display:none;"></div>
        <div class="cs-date-range">${formatDate(stats.firstDate)} - ${formatDate(stats.lastDate)}</div>

        <div class="cs-stat-row">
            <div class="cs-icon">📅</div>
            <div class="cs-label">陪伴天数</div>
            <div class="cs-value">${stats.companionDays}<small> 天</small></div>
        </div>
        <div class="cs-stat-row">
            <div class="cs-icon">🔥</div>
            <div class="cs-label">最长连续陪伴</div>
            <div class="cs-value">${stats.longestStreak}<small> 天</small></div>
        </div>
        <div class="cs-stat-row">
            <div class="cs-icon">💬</div>
            <div class="cs-label">双方消息</div>
            <div class="cs-value">${stats.totalMessages}<small> 条</small></div>
        </div>
        <div class="cs-stat-row">
            <div class="cs-icon">🔤</div>
            <div class="cs-label">聊天字数</div>
            <div class="cs-value">${wanZi}<small> 万字</small></div>
        </div>

        ${stats.debugInfo ? `<div style="font-size:11px;opacity:0.6;margin-top:14px;white-space:pre-line;">${stats.debugInfo}</div>` : ""}
      </div>`;

    // 用酒馆自带的弹窗系统显示，兼容性和层级都由酒馆自己保证
    callGenericPopup(html, POPUP_TYPE.TEXT, "", { okButton: "确定" });
}

// ============ 入口1：扩展菜单里看“当前打开的聊天” ============

function addMenuButton() {
    const buttonHtml = `
        <div id="chat-stats-button" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-solid fa-chart-simple extensionsMenuExtensionButton"></div>
            <span>聊天统计（当前）</span>
        </div>`;
    $("#extensionsMenu").append(buttonHtml);

    $(document).on("click", "#chat-stats-button", function () {
        const context = getContext();
        const chat = context.chat || [];
        if (chat.length === 0) {
            toastr.warning("当前没有聊天记录");
            return;
        }
        const character = context.characters?.[context.characterId];
        lastCharacter = character;
        const stats = buildStats(chat, character);
        checkMilestone(character, stats.companionDays);
        renderStatsPopup(stats);
    });
}

// ============ 入口2：任何地方出现的 .select_chat_block 列表都加按钮 ============

async function showStatsForFile(fileName, character) {
    toastr.info("正在读取聊天记录…", "", { timeOut: 0, extendedTimeOut: 0 });
    try {
        const cleanName = fileName.replace(/\.jsonl$/, "");

        const response = await fetch("/api/chats/get", {
            method: "POST",
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ch_name: character.name,
                file_name: cleanName,
                avatar_url: character.avatar,
            }),
        });

        if (!response.ok) {
            toastr.clear();
            alert("请求失败，状态码：" + response.status + "\n请求的文件名：" + cleanName);
            return;
        }

        const data = await response.json();
        const chatArray = Array.isArray(data) ? data : [];

        if (chatArray.length === 0) {
            toastr.clear();
            alert(
                "没能读到这条聊天的内容，可能是这条记录被重命名过、文件对不上了。\n\n" +
                    "请求的文件名：" +
                    cleanName,
            );
            return;
        }

        lastCharacter = character;

        // 临时调试信息：把实际请求内容和拿到的条数显示出来
        console.log("[聊天统计-调试] 请求文件名:", cleanName, "返回条数:", chatArray.length, data);

        const stats = buildStats(chatArray, character);
        checkMilestone(character, stats.companionDays);
        toastr.clear();
        renderStatsPopup(stats);
    } catch (err) {
        toastr.clear();
        console.error("[聊天统计] 读取失败:", err);
        alert("统计失败：" + err.message);
    }
}

function addStatsButtonToBlock(block) {
    const $block = $(block);
    if ($block.find(".cs-list-btn").length > 0) return; // 已经加过了

    const fileName = $block.attr("file_name");
    if (!fileName) return;

    const context = getContext();
    // 列表里可能是当前角色的，也可能是别的角色的（比如首页最近聊天）
    // 优先用块上如果带角色信息的属性，没有就退回用当前打开的角色
    const character = context.characters?.[context.characterId];
    if (!character) return;

    const btn = $(`<div class="cs-list-btn fa-solid fa-chart-simple" title="这条聊天的统计"></div>`);
    btn.data("filename", fileName);
    btn.data("character", character);

    const wrapper = $block.find(".select_chat_block_wrapper");
    if (wrapper.length) {
        wrapper.append(btn);
    } else {
        $block.append(btn);
    }
}

// ============ 冷落提醒 ============

const NEGLECT_THRESHOLD_DAYS = 7;

function isNeglectEnabled() {
    const v = localStorage.getItem("cs-neglect-enabled");
    return v === null ? true : v === "1"; // 默认开启
}

function setNeglectEnabled(val) {
    localStorage.setItem("cs-neglect-enabled", val ? "1" : "0");
}

function parseChatDateTitle(str) {
    if (!str) return null;
    const m = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return new Date(
        parseInt(m[1], 10),
        parseInt(m[2], 10) - 1,
        parseInt(m[3], 10),
        parseInt(m[4], 10),
        parseInt(m[5], 10),
    );
}

function addNeglectBadge($info) {
    if (!isNeglectEnabled()) return;
    if ($info.find(".cs-neglect-badge").length > 0) return;

    const $dateEl = $info.find(".chatDate").first();
    if ($dateEl.length === 0) return;

    const dateTitle = $dateEl.attr("title"); // 例如 "2026年7月14日 17:21"
    const lastDate = parseChatDateTitle(dateTitle);
    if (!lastDate) return;

    const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
    if (daysSince < NEGLECT_THRESHOLD_DAYS) return;

    const badge = $(`<span class="cs-neglect-badge">💔${daysSince}天没聊了</span>`);
    $dateEl.after(badge);
}

function addStatsButtonToRecentChat(block) {
    const $info = $(block);
    if ($info.find(".cs-list-btn").length > 0) return; // 已经加过了

    const $chatNameDiv = $info.find(".chatName").first();
    if ($chatNameDiv.length === 0) return;

    // title属性里就是完整文件名，例如："岑樾 - 2026-07-06@22h14m23s932ms.jsonl"
    const fileName = $chatNameDiv.attr("title");
    const charName = $info.find(".characterName").first().text().trim();

    if (!fileName || !charName) return;

    const context = getContext();
    const character = (context.characters || []).find((c) => c.name === charName);
    if (!character) return;

    const btn = $(
        `<button type="button" class="menu_button menu_button_icon cs-list-btn interactable" title="这条聊天的统计" role="button" tabindex="0"><i class="fa-solid fa-chart-simple fa-fw"></i></button>`,
    );
    btn.data("filename", fileName);
    btn.data("character", character);

    const actions = $info.find(".chatActions").first();
    if (actions.length) {
        actions.prepend(btn);
    } else {
        $info.append(btn);
    }
}

function initChatListButtons() {
    // 页面加载时如果已经有列表了，先扫一遍
    $(".recentChatInfo").each(function () {
        addStatsButtonToRecentChat(this);
        addNeglectBadge($(this));
    });
    // 之前的“切换聊天”弹窗结构，如果存在也顺便支持
    $(".select_chat_block").each(function () {
        addStatsButtonToBlock(this);
    });

    const observer = new MutationObserver(() => {
        $(".recentChatInfo").each(function () {
            addStatsButtonToRecentChat(this);
            addNeglectBadge($(this));
        });
        $(".select_chat_block").each(function () {
            addStatsButtonToBlock(this);
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// ============ 调试工具：找不到按钮位置时，用这个看真实结构 ============

function addDebugButton() {
    const buttonHtml = `
        <div id="cs-debug-button" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-solid fa-magnifying-glass extensionsMenuExtensionButton"></div>
            <span>🔍调试：查看聊天行结构</span>
        </div>`;
    $("#extensionsMenu").append(buttonHtml);

    $(document).on("click", "#cs-debug-button", function () {
        // 聊天记录行上一定有 "xx.xxMB" 这种文件大小文字，这个比“删除图标”更精准
        const allEls = document.querySelectorAll("div, span, small");
        let target = null;

        for (const el of allEls) {
            const text = el.textContent || "";
            if (/^\s*\d+(\.\d+)?\s?MB\s*$/.test(text.trim())) {
                target = el;
                break;
            }
        }

        if (!target) {
            alert(
                "没找到聊天记录行。请确认现在停在【最近的聊天】首页（能看到岑樾、江裴肆这些记录的那个页面），不是已经点进某个角色聊天里面了，然后再点一次这个按钮",
            );
            return;
        }

        // 往上找几层，找到整行（包含头像、名字、日期、图标按钮的那个大容器）
        for (let i = 0; i < 5 && target.parentElement; i++) {
            target = target.parentElement;
            if (target.querySelector('[class*="trash"], [class*="delete"]')) break;
        }

        let html = target.outerHTML;
        if (html.length > 1800) {
            html = html.substring(0, 1800) + "\n...(太长，截断了)";
        }

        alert("找到的结构（把这个截图发给我）：\n\n" + html);
        console.log("[聊天统计-调试]", target);
    });
}

function addDebugAvatarButton() {
    const buttonHtml = `
        <div id="cs-debug-avatar-button" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-solid fa-user extensionsMenuExtensionButton"></div>
            <span>🔍调试：user头像字段</span>
        </div>`;
    $("#extensionsMenu").append(buttonHtml);

    $(document).on("click", "#cs-debug-avatar-button", function () {
        const context = getContext();
        let info = "";

        const topKeys = Object.keys(context).filter((k) => /avatar|persona/i.test(k));
        info += "【顶层字段】\n";
        if (topKeys.length === 0) info += "（没有）\n";
        for (const k of topKeys) {
            let val = context[k];
            if (typeof val === "object") {
                try {
                    val = JSON.stringify(val).substring(0, 200);
                } catch (e) {
                    val = "[对象]";
                }
            }
            info += `${k} = ${val}\n`;
        }

        if (context.powerUserSettings && typeof context.powerUserSettings === "object") {
            const puKeys = Object.keys(context.powerUserSettings).filter((k) =>
                /avatar|persona/i.test(k),
            );
            info += "\n【powerUserSettings里】\n";
            if (puKeys.length === 0) info += "（没有）\n";
            for (const k of puKeys) {
                let val = context.powerUserSettings[k];
                if (typeof val === "object") {
                    try {
                        val = JSON.stringify(val).substring(0, 300);
                    } catch (e) {
                        val = "[对象]";
                    }
                }
                info += `${k} = ${val}\n`;
            }
        }

        alert(info || "没找到相关字段");
    });
}

// ============ 作者信息 ============

const AUTHOR_NOTICE =
    "✍🏻作者：槐🕷️/q2766593698（小红书同号）\n\n" +
    "⚠️重要事项⚠️\n" +
    "🔴只发布在QQ小群里，仅限在小群里的妹子们使用，退群既放弃使用使用权\n" +
    "🔴插件仅限定于个人（云）酒馆，禁止公共云酒馆‼️\n" +
    "🔴🈲任何形式的二传、倒卖、商业用途及非授权平台发布";

function renderAuthorPanelInner() {
    const enabled = isMilestoneEnabled();
    const neglectEnabled = isNeglectEnabled();
    return `
        <div style="text-align:left; white-space:pre-line; font-size:13px; line-height:1.6;">
          ${AUTHOR_NOTICE}
        </div>
        <hr style="margin:14px 0; opacity:0.3;"/>
        <div class="cs-milestone-row" style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
          <span>🔔 纪念日提醒</span>
          <span class="cs-milestone-state">${enabled ? "开" : "关"}</span>
        </div>
        <div class="cs-neglect-row" style="display:flex; align-items:center; justify-content:space-between; cursor:pointer; margin-top:6px;">
          <span>💔 冷落提醒</span>
          <span class="cs-neglect-state">${neglectEnabled ? "开" : "关"}</span>
        </div>
        <div class="cs-neglect-list-row" style="display:flex; align-items:center; justify-content:space-between; cursor:pointer; margin-top:6px;">
          <span>📋 查看冷落角色列表</span>
          <span>›</span>
        </div>
    `;
}

$(document).on("click", ".cs-author-icon", function (e) {
    e.stopPropagation();
    const html = `<div id="cs-author-panel">${renderAuthorPanelInner()}</div>`;
    callGenericPopup(html, POPUP_TYPE.TEXT, "", { okButton: "关闭" });
});

$(document).on("click", ".cs-neglect-list-row", function () {
    showNeglectList();
});

$(document).on("click", ".cs-milestone-row", function () {
    const next = !isMilestoneEnabled();
    setMilestoneEnabled(next);
    $(this).find(".cs-milestone-state").text(next ? "开" : "关");
    toastr.info(next ? "纪念日提醒已开启" : "纪念日提醒已关闭");
});

$(document).on("click", ".cs-neglect-row", function () {
    const next = !isNeglectEnabled();
    setNeglectEnabled(next);
    $(this).find(".cs-neglect-state").text(next ? "开" : "关");
    toastr.info(next ? "冷落提醒已开启，刷新页面生效" : "冷落提醒已关闭，刷新页面生效");
});

function showNeglectList() {
    const rows = [];

    $(".recentChatInfo").each(function () {
        const $info = $(this);
        const charName = $info.find(".characterName").first().text().trim();
        const dateTitle = $info.find(".chatDate").first().attr("title");
        const lastDate = parseChatDateTitle(dateTitle);
        if (!charName || !lastDate) return;

        const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
        rows.push({ charName, daysSince });
    });

    const $panel = $("#cs-author-panel");
    if ($panel.length === 0) return;

    if (rows.length === 0) {
        $panel.html(
            `<div style="text-align:center; padding:10px 0;">没有扫描到聊天记录，请先回到【最近的聊天】首页再试</div>
             <div class="cs-back-row" style="text-align:center; margin-top:14px; cursor:pointer; text-decoration:underline; opacity:0.7;">‹ 返回</div>`,
        );
        return;
    }

    rows.sort((a, b) => b.daysSince - a.daysSince);
    const neglected = rows.filter((r) => r.daysSince >= NEGLECT_THRESHOLD_DAYS);

    let listHtml;
    if (neglected.length === 0) {
        listHtml = `<div style="text-align:center; padding:10px 0;">目前没有超过${NEGLECT_THRESHOLD_DAYS}天没聊的角色，都还挺常联系的 👍</div>`;
    } else {
        listHtml = neglected
            .map(
                (r) =>
                    `<div style="display:flex; justify-content:space-between; padding:8px 4px; border-bottom:1px solid rgba(128,128,128,0.15);">
                        <span>${r.charName}</span>
                        <span style="color:#e05252; font-weight:600;">${r.daysSince}天</span>
                    </div>`,
            )
            .join("");
    }

    $panel.html(
        `<div style="text-align:left; font-size:14px;">${listHtml}</div>
         <div class="cs-back-row" style="text-align:center; margin-top:14px; cursor:pointer; text-decoration:underline; opacity:0.7;">‹ 返回</div>`,
    );
}

$(document).on("click", ".cs-back-row", function () {
    const $panel = $("#cs-author-panel");
    if ($panel.length > 0) {
        $panel.html(renderAuthorPanelInner());
    }
});

// ============ 纪念日提醒 ============

const MILESTONES = [7, 30, 50, 100, 200, 365, 500, 1000];

function isMilestoneEnabled() {
    const v = localStorage.getItem("cs-milestone-enabled");
    return v === null ? true : v === "1"; // 默认开启
}

function setMilestoneEnabled(val) {
    localStorage.setItem("cs-milestone-enabled", val ? "1" : "0");
}

function checkMilestone(character, companionDays) {
    if (!isMilestoneEnabled() || !character) return;

    const key = `cs-milestone-seen-${character.avatar}`;
    let seen = [];
    try {
        seen = JSON.parse(localStorage.getItem(key) || "[]");
    } catch (e) {
        seen = [];
    }

    let hasNew = false;
    for (const m of MILESTONES) {
        if (companionDays >= m && !seen.includes(m)) {
            toastr.success(`和 ${character.name} 已经陪伴了 ${m} 天啦 🎉`, "纪念日", {
                timeOut: 6000,
            });
            seen.push(m);
            hasNew = true;
        }
    }

    if (hasNew) {
        localStorage.setItem(key, JSON.stringify(seen));
    }
}

function addMilestoneToggleButton() {
    const buttonHtml = `
        <div id="cs-milestone-toggle" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-solid fa-bell extensionsMenuExtensionButton"></div>
            <span>🔔纪念日提醒：${isMilestoneEnabled() ? "开" : "关"}</span>
        </div>`;
    $("#extensionsMenu").append(buttonHtml);

    $(document).on("click", "#cs-milestone-toggle", function () {
        const next = !isMilestoneEnabled();
        setMilestoneEnabled(next);
        $(this).find("span").text(`🔔纪念日提醒：${next ? "开" : "关"}`);
        toastr.info(next ? "纪念日提醒已开启" : "纪念日提醒已关闭");
    });
}

// 每次切换/打开聊天时，自动检查一次当前角色是否到达纪念日（不用专门点统计才会提醒）
function initMilestoneAutoCheck() {
    try {
        const context = getContext();
        if (!context.eventSource || !context.event_types) return;

        context.eventSource.on(context.event_types.CHAT_CHANGED, function () {
            const ctx = getContext();
            const chat = ctx.chat || [];
            if (chat.length === 0) return;
            const character = ctx.characters?.[ctx.characterId];
            if (!character) return;
            const stats = buildStats(chat, character);
            checkMilestone(character, stats.companionDays);
        });
    } catch (e) {
        console.error("[聊天统计] 纪念日自动检测初始化失败:", e);
    }
}

// ============ 换头像 ============

$(document).on("click", ".cs-cycle-avatar", function () {
    const $picker = $(this).next(".cs-avatar-picker");

    if ($picker.is(":visible")) {
        $picker.hide().empty();
        return;
    }

    const context = getContext();
    const personas = context.powerUserSettings?.personas || {};
    const files = Object.keys(personas);

    if (files.length === 0) {
        alert("没有找到任何persona头像");
        return;
    }

    $picker.empty();
    files.forEach((file) => {
        const thumb = $(
            `<img class="cs-avatar-choice" src="/User Avatars/${encodeURIComponent(file)}" />`,
        );
        thumb.on("click", function (e) {
            e.stopPropagation();
            e.preventDefault();
            if (!lastCharacter) return;
            setPersonaChoice(lastCharacter, file);
            const newSrc = `/User Avatars/${encodeURIComponent(file)}`;
            if (lastStats) lastStats.userAvatar = newSrc;
            // 原地换图，不重新弹窗
            $(".cs-avatars .cs-avatar").first().attr("src", newSrc).css("visibility", "visible");
            $picker.hide().empty();
        });
        $picker.append(thumb);
    });

    $picker.show();
});

// 头像点击也用捕获阶段拦截，防止触发酒馆自带的查看大图
document.addEventListener(
    "click",
    function (e) {
        if (e.target && e.target.classList && e.target.classList.contains("cs-avatar")) {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
    },
    true,
);

// 用捕获阶段拦截，确保比酒馆自己"点这一行打开聊天"的监听更早触发
document.addEventListener(
    "click",
    function (e) {
        const btn = e.target.closest && e.target.closest(".cs-list-btn");
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        const fileName = $(btn).data("filename");
        const character = $(btn).data("character");
        if (fileName && character) {
            showStatsForFile(fileName, character);
        }
    },
    true,
);

// ============ 初始化 ============

jQuery(async () => {
    addMenuButton();
    initChatListButtons();
    initMilestoneAutoCheck();
});
