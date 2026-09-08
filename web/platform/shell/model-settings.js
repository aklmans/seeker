// @ts-check
import { rt } from '../runtime/index.js';
import { tt } from './i18n.js';
import { cEsc } from './copilot-chrome.js';

/** @type {Record<import('../runtime/types').AiConfig['protocol'],string>} */
const BASES={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com',gemini:'https://generativelanguage.googleapis.com/v1beta',ollama:'http://localhost:11434/v1'};
/** @param {unknown} error */
function connectionHint(error){
  const value=String(error instanceof Error?error.message:error);
  if(/401|403|api.?key|unauthori|forbidden|鉴权|密钥|钥匙串/i.test(value))return tt('请核对服务商、Key 和该模型的访问权限。Key 需要在系统钥匙串中成功保存。','Check the provider, API key and model access. The key must be saved successfully in the system keychain.');
  if(/404|model.*(not found|unknown)|模型.*(不存在|未找到)/i.test(value))return tt('请核对模型的完整名称，以及地址是否对应所选协议。','Check the full model name and whether the address matches the selected protocol.');
  if(/429|quota|rate.?limit|额度/i.test(value))return tt('服务商的额度或请求频率受限，请检查其控制台后重试。','Check your provider’s quota or rate limit, then retry.');
  if(/timeout|timed out|connect|network|dns|error sending request|failed to fetch|连接|超时|网络/i.test(value))return tt('请检查服务地址和网络；使用本地模型时，确认模型服务正在运行。','Check the address and network. For a local model, confirm the model server is running.');
  return tt('请检查连接信息后重试。也可以把下方错误提供给内测协助者。','Check the connection details and retry, or share the error below with your test organizer.');
}

/** Model setup never writes until the user explicitly saves/tests. @param {HTMLElement|null} host */
export async function renderModelSettings(host){
  if(!host)return;
  const desktop=rt.platform==='desktop';
  host.innerHTML='<p class="seclabel">— MODEL</p><h2 class="sectitle">'+tt('连接你的模型','Connect your model')+'<span class="dot">.</span></h2><p style="line-height:1.8;max-width:640px;">'+tt('桌面内测版使用你选择的模型服务。首次可请内测协助者帮忙配置；笔记、收藏和文件文字预览无需连接模型。','This desktop test build uses your chosen model service. Your test organizer can help with initial setup. Notes, favorites and file text previews work without a model.')+'</p>';
  if(!desktop){
    host.insertAdjacentHTML('beforeend','<p id="mdStatus" role="status">'+tt('网页版不保存桌面模型 Key，也不能执行文字工具、文件问答或整理任务。网页聊天如已配置演示代理，可通过聊天入口使用。','The web version does not store desktop API keys or run text tools, file Q&A or organizer tasks. Web chat is available through the chat entry when a demo proxy is configured.')+'</p><label for="mdProto">'+tt('桌面支持的协议','Desktop protocols')+'</label><select class="select" id="mdProto" disabled>'+protocolOptions('openai')+'</select>');
    return;
  }
  const body=document.createElement('div');host.appendChild(body);body.textContent=tt('正在读取已保存的配置…','Loading saved configuration…');
  /** @type {import('../runtime/types').AiConfig} */
  let config;
  try{config=await rt.ai.getConfig();}
  catch(e){if(body.isConnected){body.textContent=tt('无法读取配置，尚未进行修改：','Could not load configuration. No changes made: ')+String(e);const retry=document.createElement('button');retry.className='btn';retry.textContent=tt('重试','Retry');retry.onclick=()=>{void renderModelSettings(host);};body.appendChild(retry);}return;}
  if(!body.isConnected)return;
  /** @param {string} label @param {string} text @param {string} id */
  const field=(label,text,id)=>'<div class="set-row"><label class="sk" for="'+id+'">'+label+'</label><div>'+text+'</div></div>';
  /** @param {string} id @param {string} value @param {string} [placeholder] */
  const input=(id,value,placeholder='')=>'<input class="input" id="'+id+'" value="'+cEsc(value||'')+'" placeholder="'+cEsc(placeholder)+'" style="width:100%;">';
  body.innerHTML=`<div style="max-width:680px;"><ol style="line-height:1.9;padding-left:20px;"><li>${tt('选择服务商提供的协议。','Choose the protocol provided by your service.')}</li><li>${tt('填写服务地址、模型名和 Key。本地 Ollama 无需 Key。','Enter the service address, model name and API key. Local Ollama needs no key.')}</li><li>${tt('保存后测试连接；测试仅发送一条固定短请求。','Save and test. The test sends only a fixed short request.')}</li></ol><fieldset id="mdFields" style="border:0;padding:0;margin:0;min-width:0;">
    ${field(tt('接口协议','Protocol'),'<select class="select" id="mdProto">'+protocolOptions(config.protocol)+'</select>','mdProto')}
    ${field(tt('服务地址','Service address'),input('mdBase',config.baseUrl)+'<button class="btn-text" id="mdDefaultBase" type="button">'+tt('填入默认地址','Use default address')+'</button>','mdBase')}
    ${field(tt('模型名称','Model name'),input('mdModel',config.model,tt('填写服务商提供的完整模型名','Enter the full model name from your provider')),'mdModel')}
    ${config.models.length?field(tt('已保存的模型','Saved models'),'<select class="select" id="mdSavedModels"><option value="">'+tt('选择以填入','Choose a model')+'</option>'+config.models.map(m=>'<option value="'+cEsc(m)+'">'+cEsc(m)+'</option>').join('')+'</select>','mdSavedModels'):''}
    <div id="mdKeyRow">${field('API Key','<input class="input" id="mdKey" type="password" autocomplete="new-password" placeholder="'+tt(config.keyStatus==='configured'?'已配置 · 留空保持原 Key':'填写服务商提供的 Key',config.keyStatus==='configured'?'Configured · leave blank to keep':'Enter your provider’s API key')+'" style="width:100%;"><p style="font-size:12px;">'+tt('新 Key 只在保存时写入系统钥匙串，不显示已保存的明文。','A new key is saved only to the system keychain. Saved keys are never displayed.')+'</p>','mdKey')}</div>
    <p id="mdLocalHint" style="font-size:12px;">${tt('本地 Ollama 不读取或转发已保存的云端 Key。需要鉴权的兼容代理请选择 OpenAI 兼容。','Local Ollama does not read or forward a saved cloud key. Use OpenAI compatible for a proxy that requires authentication.')}</p>
    <details style="margin:18px 0;"><summary>${tt('高级选项（可留空）','Advanced options (optional)')}</summary>
      ${field(tt('嵌入模型','Embedding model'),input('mdEmbed',config.embedModel),'mdEmbed')}
      <p id="mdEmbedHint" style="font-size:12px;">${tt('日常写作、文件问答和资料整理不需要嵌入模型。Anthropic 协议不提供嵌入接口。','Everyday writing, file Q&A and organizing do not need an embedding model. The Anthropic protocol has no embedding endpoint.')}</p>
      ${field('User-Agent',input('mdUA',config.userAgent),'mdUA')}
      <p style="font-size:12px;">${tt('仅在服务商明确要求时填写请求标识。','Set a request identifier only if your provider requires it.')}</p>
    </details><div style="display:flex;flex-wrap:wrap;gap:10px;"><button class="btn" id="mdSave">${tt('保存配置','Save settings')}</button><button class="btn btn-accent" id="mdTest">${tt('保存并测试连接','Save and test')}</button></div>
    </fieldset><p id="mdStatus" role="status" style="line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;">${tt('修改后点击保存才会生效。','Changes take effect only after saving.')}</p><p style="font-size:12px;line-height:1.8;">${tt('使用云端服务时，你主动提交的内容会发送给该服务商。本轮没有托管订阅或免 Key 桌面服务。','When using a cloud service, content you submit goes to that provider. This build has no managed subscription or keyless desktop service.')}</p></div>`;
  /** @param {string} id */
  const el=id=>/** @type {HTMLInputElement} */(body.querySelector('#'+id));
  const protocol=()=>/** @type {import('../runtime/types').AiConfig['protocol']} */(el('mdProto').value);
  const status=/** @type {HTMLElement} */(body.querySelector('#mdStatus'));
  const fields=/** @type {HTMLFieldSetElement} */(body.querySelector('#mdFields'));
  const sync=()=>{const local=protocol()==='ollama';el('mdKeyRow').hidden=local;el('mdKey').disabled=local;el('mdLocalHint').hidden=!local;el('mdEmbed').disabled=protocol()==='anthropic';};
  el('mdProto').onchange=()=>{sync();status.textContent=tt('协议已选，地址和模型名保持原样。请核对后保存。','Protocol selected. The address and model name are kept. Review them before saving.');};
  el('mdDefaultBase').onclick=()=>{el('mdBase').value=BASES[protocol()];};
  const saved=el('mdSavedModels');if(saved)saved.onchange=()=>{if(saved.value)el('mdModel').value=saved.value;};
  let busy=false;
  /** @param {boolean} test */
  const save=async(test)=>{
    if(busy)return;
    const baseUrl=el('mdBase').value.trim(),model=el('mdModel').value.trim();
    let url;try{url=new URL(baseUrl);}catch{status.textContent=tt('请填写完整的服务地址（http:// 或 https://）。','Enter a complete service address starting with http:// or https://.');return;}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password){status.textContent=tt('服务地址只支持 HTTP/HTTPS，Key 请填写在独立输入框。','Use an HTTP/HTTPS address. Enter the API key in its own field.');return;}
    if(!model){status.textContent=tt('请填写模型名称。','Enter a model name.');return;}
    const key=protocol()==='ollama'?'':el('mdKey').value.trim();
    // Blank preserves a saved key, including after switching from a local
    // protocol whose config view intentionally never reads the cloud keychain.
    busy=true;fields.disabled=true;status.textContent=tt('正在保存…','Saving…');let configSaved=false;
    try{
      await rt.ai.setConfig({protocol:protocol(),baseUrl,model,embedModel:el('mdEmbed').value.trim(),userAgent:el('mdUA').value.trim()});configSaved=true;
      if(key){await rt.secret.set('provider.openai.key',key);el('mdKey').value='';config.keyStatus='configured';el('mdKey').placeholder=tt('已配置 · 留空保持原 Key','Configured · leave blank to keep');}
      status.textContent=tt('配置已保存。','Settings saved.');
      if(test){
        status.textContent=tt('配置已保存，正在发送固定测试请求…','Settings saved. Sending the fixed test request…');
        const result=await rt.ai.generate({instruction:'Reply with OK only.',task:'model_connection_test'}).done;
        if(result.stopReason!=='stop'||!result.text.trim())throw new Error(tt('模型未返回完整的非空回答。','The model did not return a complete, nonempty answer.'));
        status.textContent=tt('连接成功。可返回首页提问，或使用文字工具。','Connected. Return to Home to ask a question, or use a text tool.');
      }
      window.dispatchEvent(new Event('seeker-model-changed'));
    }catch(e){
      status.textContent=(configSaved?tt('连接信息已保存，本次操作未完成。','Connection settings were saved; this operation did not complete.'):tt('配置未保存。','Settings were not saved.'))+'\n'+connectionHint(e)+'\n'+String(e instanceof Error?e.message:e);
    }finally{busy=false;fields.disabled=false;sync();}
  };
  el('mdSave').onclick=()=>{void save(false);};el('mdTest').onclick=()=>{void save(true);};sync();
}

/** @param {string} selected */
function protocolOptions(selected){return [['openai',tt('OpenAI 兼容','OpenAI compatible')],['anthropic','Anthropic'],['gemini','Gemini'],['ollama',tt('Ollama 本地','Local Ollama')]].map(([id,label])=>'<option value="'+id+'" '+(selected===id?'selected':'')+'>'+label+'</option>').join('');}
