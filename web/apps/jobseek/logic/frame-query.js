// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 意图框定 frameQuery(平台化阶段3 择取搬迁 · 第8轮裁定「归属驱动零逻辑改动移动」)。
    纯 jobseek 语义:按意图关键词把用户问题框成「先用 query_data 读真实数据再答」;
    从单体壳基元(aiErrHTML/extractSeekerBlock)之间择出,那些是壳基元、留 index.html 待抽壳到 platform/shell/。
    classic 全局语义不变(manifest.js 经 SeekerShell.frameQuery 消费);依赖见 ../monolith-globals.d.ts。 */
/* domain 业务框定(接地气 AI 技能):按意图关键词把用户问题框成「先用 query_data 读真实数据再答」。
   显示给用户的仍是短文案;发给 AI 的是框定版(系统提示不动、仍在网关,守"前端不组装系统提示")。
   泛化匹配(支持"给我排一个 Rust 训练计划"等含可变内容的问法)。
   改简历红线:resumes 集合只存专业模块(联系方式绝不入集合,始终从 profile 实时渲染),
   故 query_data('resumes') 天然不含联系方式;框定再显式要求"只改专业内容、不碰联系方式"。 */
function frameQuery(text){
  const t = String(text || '');
  const G = '请**先用 query_data 工具**读取我本地的真实数据再据此回答,不要编造数据或岗位。';
  // 块4:AI 对话式 CRUD(放最前 —— 否则"把薪资改成X"会误命中下面的 value-card 等查询意图)。AI 一律只提案,落库由我在卡片确认。
  if(/删除|删掉|移除|撤掉|不要(这个|那个|它|了)|delete|remove/i.test(t) && /岗位|职位|公司|它|这个|那个|job|position|role/i.test(t))
    return G + '确认我指的是哪个岗位(拿到 id)后,**不要直接删**,在回答末尾附一个代码块发起删除提案(由我在卡片确认、可撤销):\n```seeker:job-delete\n{"id":<该岗位 id>}\n```\n我的原始请求:' + t;
  if(/(修改|更新|改成|换成|设为|设成|改为|标记为|标成|change|update|set .* to|rename|mark .* as)/i.test(t) && /岗位|职位|薪资|状态|城市|年限|学历|公司|JD|技能|它|这个|那个|job|salary|pay|status|city|company|skill/i.test(t))
    return G + '确认是哪个岗位(拿到 id)、相关字段当前值后,**不要直接改**,在回答末尾附一个代码块发起修改提案(我在卡片确认、可撤销):\n```seeker:job-update\n{"id":<该岗位 id>,"changes":[{"field":"<co/role/city/pay/years/edu/jd/summary/seniority/workMode/kind/status/need/plus 之一>","after":<新值;need/plus 为数组;status 仅 fav/todo/sent/interview/reject/skip>}]}\n```\n我的原始请求:' + t;
  if(/(加|添加|新增|录入|收藏|记一下|帮我加|存一下|存个|add|create|new|save)/i.test(t) && /岗位|职位|公司|job|position|role/i.test(t))
    return '我想新增一个目标岗位。请据我下面的描述整理字段(只填能推断的,其余留空),在回答末尾附一个代码块发起新增提案(由我在卡片确认):\n```seeker:job-create\n{"co":"","role":"","city":"","pay":"","years":"","edu":"","need":[],"plus":[],"jd":"","summary":"","seniority":"","workMode":"","highlights":[],"kind":""}\n```\n我的原始请求:' + t;
  if(/(找工作|找岗位|找机会|有哪些(公司|岗位|机会|职位)|哪里(在招|有岗|招人)|帮我找|搜(一下)?(岗位|工作|职位|公司)|find (jobs|roles|companies|openings)|job openings|who.?s hiring|search.*(jobs|positions|roles))/i.test(t))
    return G + '我想找符合我背景与需求的**真实在招岗位 / 公司官方招聘页**。先读取我的 resumes(专业内容:技能/项目/经历,**不含联系方式**)了解我的背景;**用你可用的搜索工具(如已连接的搜索 MCP)检索真实结果——绝不凭记忆编造公司、岗位或网址**,优先公司官方招聘页地址;**按与我的契合度排序**。在回答**末尾**附一个代码块渲染「机会来源卡」(url 必来自搜索结果、不得臆造;why 一句点出契合点,fit 填 高/中/低):\n```seeker:job-sources\n{"sources":[{"company":"","role":"","url":"https://…","why":"为何契合(一句)","fit":"高/中/低","kind":"官网/招聘网/社群 之一"}]}\n```\n没有可用搜索工具就直说「需先在 MCP 设置连接一个搜索 server」——**不要编造结果**。我的原始请求:' + t;
  if(/简历|resume|cv|tailor/i.test(t))
    return G + '读取我的 resumes(简历的专业内容:概要 / 技能 / 项目 / 教育 —— 本就不含联系方式,每个模块有 key)与目标 jobs(拿到 jobId),据此给出针对该岗位的简历重写建议;**只改专业内容,绝不涉及姓名 / 电话 / 邮箱 / 城市等联系方式与个人身份信息**。'
      + '若你给出了具体可直接套用的改写,请在回答**末尾**附一个代码块以便我一键应用(先正常用自然语言说明改动思路,再附代码块):\n```seeker:resume-edit\n{"jobId":<目标岗位 id>,"edits":[{"module":"<模块 key,如 summary / skills / honors / portfolio,或自定义模块 key>","content":<文本模块为字符串;skills 模块为字符串数组>}]}\n```\n'
      + 'module **只能是专业模块,绝不能是 basic 或任何联系方式 / 身份字段**;只列你确有改写的模块。我的原始请求:' + t;
  if(/面试|JD|陪我练|面试题|interview/i.test(t))
    return G + '读取我的目标 jobs(岗位/JD,含 id)后,给出贴合该岗位的面试题或面试反馈。'
      + '聚焦的那个岗位,请在回答**末尾**附一个代码块渲染面试卡(正文简洁):\n```seeker:interview-card\n{"jobId":<该岗位 id>}\n```\n我的原始请求:' + t;
  if(/训练计划|学习路线|怎么补|如何补|补齐|计划|training plan|study plan|learn|roadmap/i.test(t))
    return G + '读取我的 skills(技能现状)、actions(在进行的训练)、jobs(目标岗位)后,给出针对我缺口与目标的具体训练计划。'
      + '聚焦要补的那项技能,请在回答**末尾**附一个代码块以渲染交互计划卡(正文保持简洁):\n```seeker:plan-card\n{"skill":"<要补的技能名,如 Rust / K8s / 分布式系统 / 系统设计>"}\n```\n我的原始请求:' + t;
  if(/匹配|该投|投哪|which job|best fit|should i apply|apply to/i.test(t))
    return G + '读取我的 jobs(目标岗位,含 id)与 skills(我的技能)后,分析我最该投哪个岗位、理由、以及最关键的能力缺口。'
      + '聚焦的那个岗位,请在回答**末尾**附一个代码块以渲染交互雷达卡(正文保持简洁,不必重复卡里的数字):\n```seeker:match-card\n{"jobId":<该岗位 id>}\n```\n我的原始请求:' + t;
  if(/缺口|短板|不足|skill gap|biggest gap|weakness/i.test(t))
    return G + '读取我的 skills 与 jobs 后,对照目标岗位找出我最关键的能力缺口与补齐方向。'
      + '请在回答**末尾**附一个代码块渲染缺口卡(正文简洁):\n```seeker:gaps-card\n{}\n```\n我的原始请求:' + t;
  if(/最该做|下一步|现在做什么|该做什么|what should i do|do next|next step/i.test(t))
    return G + '读取我的 jobs/actions/skills 后,告诉我现在最该做什么、为什么(简洁)。'
      + '请在回答**末尾**附一个代码块渲染「下一步」轻卡:\n```seeker:next-card\n{}\n```\n我的原始请求:' + t;
  if(/市场价值|身价|值多少|薪资|薪酬|market value|how much.*worth|my worth|salary range/i.test(t))
    return G + '读取我的 skills 与 jobs 后,给出有依据的市场价值/薪资判断。'
      + '请在回答**末尾**附一个代码块渲染市场价值卡(正文简洁):\n```seeker:value-card\n{}\n```\n我的原始请求:' + t;
  return text;
}
