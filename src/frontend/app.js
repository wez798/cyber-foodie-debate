// Cyber Foodie Debate - Frontend Application

const API_BASE = 'http://localhost:8000/api/v1';

const form = document.getElementById('preference-form');
const debateStage = document.getElementById('debate-stage');
const startBtn = document.getElementById('start-btn');
const agentAContent = document.getElementById('agent-a-content');
const agentBContent = document.getElementById('agent-b-content');
const debateResult = document.getElementById('debate-result');
const resultContent = document.getElementById('result-content');

let currentSessionId = null;

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const preference = {
        "口味": document.getElementById('taste').value,
        "预算": document.getElementById('budget').value,
        "天气": document.getElementById('weather').value,
        "忌口": document.getElementById('allergy').value || null,
        "其他要求": null
    };

    startBtn.disabled = true;
    startBtn.textContent = '⏳ 辩论进行中...';
    debateStage.style.display = 'block';
    debateResult.style.display = 'none';
    agentAContent.textContent = '';
    agentBContent.textContent = '';
    agentAContent.style.opacity = '0.5';
    agentBContent.style.opacity = '0.5';

    try {
        const response = await fetch(`${API_BASE}/debate/start-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preference: preference,
                agent_a_persona: "sichuan_spicy",
                agent_b_persona: "cantonese_healthy",
                max_rounds: 3
            })
        });

        if (!response.ok) {
            throw new Error(`API错误: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalData = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));
                    handleStreamEvent(data);
                }
            }
        }
    } catch (error) {
        agentAContent.textContent = `❌ 请求失败: ${error.message}`;
        agentBContent.textContent = '请检查后端服务是否启动，以及 .env 中 API Key 是否配置。';
        agentAContent.style.opacity = '1';
        agentBContent.style.opacity = '1';
    } finally {
        startBtn.disabled = false;
        startBtn.textContent = '🔥 开始辩论！';
    }
});

function handleStreamEvent(data) {
    if (data.event === 'session_start') {
        currentSessionId = data.data.session_id;
    } else if (data.event === 'round') {
        const round = data.data.round;
        const side = data.data.side;
        const contentEl = side === 'agent_a' ? agentAContent : agentBContent;
        const prefix = side === 'agent_a' ? '🌶️ 川辣派·老麻' : '🍵 粤式养生·阿靓';
        contentEl.textContent += `【第${round.round_number}轮】${prefix}:\n${round.content}\n\n`;
        contentEl.style.opacity = '1';
    } else if (data.event === 'result') {
        renderDebateResult(data.data);
    }
}

function renderDebateResult(data) {
    debateResult.style.display = 'block';
    const winnerName = data.result.winner === 'sichuan_spicy' ? '🌶️ 川辣派·老麻' : '🍵 粤式养生·阿靓';
    resultContent.innerHTML = `
        <p><strong>🏆 获胜方：</strong>${winnerName}</p>
        <p><strong>🍽️ 推荐菜品：</strong>${data.result.dish_name}</p>
        <p><strong>📍 餐厅建议：</strong>${data.result.restaurant_suggestion || '暂无'}</p>
        <p><strong>📊 置信度：</strong>${(data.result.confidence * 100).toFixed(0)}%</p>
        <button class="btn-tts" onclick="playTTS('${data.session_id}')">🔊 语音播报结果</button>
        <audio id="tts-audio" controls style="display:none; width:100%; margin-top:10px;"></audio>
    `;
    debateStage.scrollIntoView({ behavior: 'smooth' });
}

function renderDebate(data) {
    const rounds = data.rounds || [];
    const aRounds = rounds.filter(r => r.speaker === 'sichuan_spicy');
    const bRounds = rounds.filter(r => r.speaker === 'cantonese_healthy');

    let aText = '';
    let bText = '';

    aRounds.forEach(r => {
        aText += `【第${r.round_number}轮】\n${r.content}\n\n`;
    });

    bRounds.forEach(r => {
        bText += `【第${r.round_number}轮】\n${r.content}\n\n`;
    });

    agentAContent.textContent = aText || '暂无内容';
    agentBContent.textContent = bText || '暂无内容';

    if (data.result) {
        debateResult.style.display = 'block';
        const winnerName = data.result.winner === 'sichuan_spicy' ? '🌶️ 川辣派·老麻' : '🍵 粤式养生·阿靓';
        resultContent.innerHTML = `
            <p><strong>🏆 获胜方：</strong>${winnerName}</p>
            <p><strong>🍽️ 推荐菜品：</strong>${data.result.dish_name}</p>
            <p><strong>📍 餐厅建议：</strong>${data.result.restaurant_suggestion || '暂无'}</p>
            <p><strong>📊 置信度：</strong>${(data.result.confidence * 100).toFixed(0)}%</p>
            <button class="btn-tts" onclick="playTTS('${data.session_id}')">🔊 语音播报结果</button>
            <audio id="tts-audio" controls style="display:none; width:100%; margin-top:10px;"></audio>
        `;
    }

    debateStage.scrollIntoView({ behavior: 'smooth' });
}

async function playTTS(sessionId) {
    const audioEl = document.getElementById('tts-audio');
    try {
        const response = await fetch(`${API_BASE}/tts/synthesize-debate-result?session_id=${sessionId}`);
        if (!response.ok) {
            throw new Error(`TTS 错误: ${response.status}`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        audioEl.src = url;
        audioEl.style.display = 'block';
        audioEl.play();
    } catch (error) {
        alert(`语音播报失败: ${error.message}`);
    }
}
