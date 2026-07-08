// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 业务数据(平台化阶段3-f 择取搬迁 · 第8轮裁定 C「归属驱动零改动移动」)。
    纯 jobseek 数据 const:岗位状态 STATUS / 岗位 JOBS / 技能 SKILLS+分类 / 行动 ACTIONS / 分析数据(TOP_GAPS/KEYWORDS/PIPELINE/分布);
    纯字面量、无壳依赖。通用 UI 图标 IC 是壳基元、留 index.html 待抽壳。
    ⚠ 数据基础层:外链置于内联块 A 之前 —— 消费者(logic 解析期 match.js 读 JOBS[0])须在其后。
    classic 全局语义不变;依赖见 ./monolith-globals.d.ts。 */
/* ============ MOCK DATA ============ */
export const STATUS = {
  fav:{k:'fav', label:'收藏', cls:'b-info'},
  todo:{k:'todo', label:'待投', cls:'b-todo'},
  sent:{k:'sent', label:'已投', cls:'b-sent'},
  interview:{k:'interview', label:'面试中', cls:'b-interview'},
  reject:{k:'reject', label:'拒绝', cls:'b-reject'},
  skip:{k:'skip', label:'放弃', cls:'b-skip'}
};

export const JOBS = [
  {id:1, co:'字节跳动', role:'后端高级工程师 · 推荐架构', city:'北京', kind:'一线大厂', status:'interview',
   interest:9.0, growth:8.0, match:7.5, chance:6.5, pay:'40-65万', src:'内推', years:'5+', edu:'本科+',
   need:['Go','微服务','Redis','MySQL','K8s','高并发'], plus:['Rust','分布式系统','性能优化'],
   jd:'团队负责字节核心推荐系统的后端架构与稳定性建设,服务日均请求量千亿级。\n\n岗位职责:\n- 负责推荐系统在线服务的架构设计与性能优化,保障高并发场景下的稳定性;\n- 推动服务治理、容量规划与线上故障应急,持续提升系统可用性;\n- 主导核心链路的重构与演进,Owner 关键技术方向。\n\n任职要求:\n- 5 年以上后端开发经验,精通 Go,熟悉微服务架构;\n- 深入理解 Redis / MySQL,有大规模高并发系统实战经验;\n- 熟悉 K8s 容器化部署,有分布式系统设计经验者优先;\n- 有较强的稳定性意识与线上问题排查能力,能推动复杂项目落地。'},
  {id:2, co:'蚂蚁集团', role:'平台架构工程师 · 中间件', city:'杭州', kind:'一线大厂', status:'sent',
   interest:8.5, growth:7.5, match:7.0, chance:6.0, pay:'50-70万', src:'BOSS直聘', years:'6+', edu:'本科+',
   need:['Java','分布式系统','Kafka','gRPC','系统设计','服务治理'], plus:['Rust','K8s','DDD'],
   jd:'蚂蚁中间件团队负责支撑集团核心金融场景的分布式基础设施。\n\n岗位职责:\n- 设计与研发高可用、高性能的分布式中间件,服务集团百万级 QPS;\n- 推动中间件在金融级稳定性场景下的落地与演进;\n- 负责系统设计评审、容量规划与线上故障复盘。\n\n任职要求:\n- 6 年以上后端经验,精通 Java 及 JVM 调优;\n- 深入理解分布式系统理论,有 Kafka / gRPC 实战经验;\n- 具备扎实的系统设计能力,熟悉服务治理体系;\n- 有金融级稳定性建设经验、DDD 实践者优先。'},
  {id:3, co:'美团', role:'核心配送平台后端', city:'北京', kind:'一线大厂', status:'todo',
   interest:8.0, growth:7.0, match:8.0, chance:7.0, pay:'35-55万', src:'拉勾', years:'4+', edu:'本科+',
   need:['Go','微服务','MySQL','Redis','高并发','监控告警'], plus:['K8s','性能优化'],
   jd:'美团配送平台负责支撑全国即时配送的调度与履约系统。\n\n岗位职责:\n- 负责配送核心链路的后端研发,支撑千万级日订单的高并发履约;\n- 优化系统性能与稳定性,建设完善的监控告警体系;\n- 参与服务治理与微服务拆分,推动核心系统演进。\n\n任职要求:\n- 4 年以上后端经验,精通 Go 语言;\n- 熟悉微服务架构与 MySQL / Redis 大规模实践;\n- 有高并发系统优化经验,熟悉监控告警体系建设;\n- 有较强的 Owner 意识,能独立推动项目落地。'},
  {id:4, co:'阿里巴巴', role:'基础设施工程师 · 云原生', city:'杭州', kind:'一线大厂', status:'fav',
   interest:8.5, growth:8.5, match:6.5, chance:5.5, pay:'45-68万', src:'内推', years:'5+', edu:'本科+',
   need:['Go','K8s','Docker','分布式系统','Linux系统','服务治理'], plus:['Rust','gRPC'],
   jd:'阿里云原生团队负责集团容器与调度基础设施的研发。\n\n岗位职责:\n- 负责大规模 K8s 集群的研发与运维,支撑集团百万级容器;\n- 优化调度、弹性与资源利用率,推动云原生技术落地;\n- 参与底层基础设施的稳定性建设与故障应急。\n\n任职要求:\n- 5 年以上经验,精通 Go,深入理解 K8s / Docker 原理;\n- 熟悉 Linux 系统底层,有大规模分布式系统经验;\n- 有云原生、服务治理领域实战经验;\n- 熟悉 gRPC、有开源贡献者优先。'},
  {id:5, co:'腾讯', role:'微信支付后端工程师', city:'深圳', kind:'一线大厂', status:'fav',
   interest:8.8, growth:7.0, match:7.0, chance:6.0, pay:'42-62万', src:'BOSS直聘', years:'5+', edu:'本科+',
   need:['C++','Go','高并发','分布式系统','MySQL','系统设计'], plus:['Redis','性能优化'],
   jd:'微信支付后端团队负责支撑亿级用户的金融交易系统。\n\n岗位职责:\n- 负责支付核心交易链路的研发,保障资金安全与系统稳定;\n- 设计高并发、高可用的分布式交易系统;\n- 持续优化系统性能,推动核心系统架构演进。\n\n任职要求:\n- 5 年以上后端经验,精通 C++ 或 Go;\n- 深入理解高并发、分布式系统设计;\n- 熟悉 MySQL 大规模实践,有金融级稳定性经验优先;\n- 具备优秀的系统设计能力与稳定性意识。'},
  {id:6, co:'拼多多', role:'推荐系统工程师', city:'上海', kind:'一线大厂', status:'sent',
   interest:8.2, growth:7.5, match:6.0, chance:5.0, pay:'48-70万', src:'猎头', years:'4+', edu:'本科+',
   need:['Go','Rust','高并发','Redis','Kafka','性能优化'], plus:['分布式系统','K8s'],
   jd:'拼多多推荐工程团队负责支撑电商场景的实时推荐系统。\n\n岗位职责:\n- 负责推荐在线服务的工程架构,支撑超高并发实时计算;\n- 用 Rust / Go 构建高性能服务,持续做性能优化;\n- 推动 0-1 的核心系统建设与落地。\n\n任职要求:\n- 4 年以上后端经验,精通 Go,熟悉 Rust 者优先;\n- 有超高并发系统的性能优化实战经验;\n- 熟悉 Redis / Kafka 等中间件;\n- 有推荐 / 广告系统经验者优先。'},
  {id:7, co:'百度', role:'搜索基础架构工程师', city:'北京', kind:'一线大厂', status:'fav',
   interest:7.8, growth:7.0, match:7.5, chance:6.5, pay:'38-58万', src:'拉勾', years:'5+', edu:'本科+',
   need:['C++','分布式系统','性能优化','Linux系统','系统设计','高并发'], plus:['Go','监控告警'],
   jd:'百度搜索基础架构团队负责搜索引擎底层系统的研发。\n\n岗位职责:\n- 负责搜索底层检索系统的研发与性能优化;\n- 设计高性能、大规模的分布式检索架构;\n- 推动核心系统的稳定性与效率提升。\n\n任职要求:\n- 5 年以上经验,精通 C++,熟悉 Linux 系统编程;\n- 深入理解分布式系统与性能优化;\n- 有大规模在线系统的系统设计经验;\n- 有搜索 / 存储 / 计算引擎经验者优先。'},
  {id:8, co:'快手', role:'实时计算平台后端', city:'北京', kind:'一线大厂', status:'todo',
   interest:8.0, growth:8.0, match:6.5, chance:5.5, pay:'40-60万', src:'内推', years:'4+', edu:'本科+',
   need:['Java','Kafka','分布式系统','高并发','服务治理','MySQL'], plus:['Go','K8s'],
   jd:'快手实时计算团队负责支撑短视频场景的流式计算平台。\n\n岗位职责:\n- 负责实时计算平台的研发,支撑 PB 级实时数据处理;\n- 建设高吞吐、低延迟的流式计算系统;\n- 推动平台稳定性与服务治理体系建设。\n\n任职要求:\n- 4 年以上后端经验,精通 Java;\n- 熟悉 Kafka 及流式计算,理解分布式系统;\n- 有高并发、大数据量场景实战经验;\n- 熟悉服务治理体系建设。'},
  {id:9, co:'小红书', role:'电商平台后端工程师', city:'上海', kind:'独角兽/二线', status:'fav',
   interest:8.3, growth:7.5, match:7.0, chance:6.5, pay:'38-56万', src:'BOSS直聘', years:'4+', edu:'本科+',
   need:['Go','微服务','MySQL','Redis','DDD','系统设计'], plus:['K8s','分布式系统'],
   jd:'小红书电商团队负责支撑社区电商交易与履约系统。\n\n岗位职责:\n- 负责电商交易核心链路的后端研发;\n- 用 DDD 思想推动复杂业务系统的建模与落地;\n- 优化系统稳定性,推动微服务架构演进。\n\n任职要求:\n- 4 年以上后端经验,精通 Go;\n- 熟悉微服务、MySQL / Redis 实战;\n- 有 DDD、复杂业务系统设计经验优先;\n- 有电商 / 交易系统经验者优先。'},
  {id:10, co:'滴滴', role:'出行平台架构师', city:'北京', kind:'一线大厂', status:'reject',
   interest:7.5, growth:7.0, match:6.0, chance:4.5, pay:'45-65万', src:'猎头', years:'7+', edu:'本科+',
   need:['Go','分布式系统','系统设计','服务治理','高并发','K8s'], plus:['Rust','监控告警'],
   jd:'滴滴出行平台团队负责支撑全国出行调度的核心系统。\n\n岗位职责:\n- 负责出行平台的架构设计与技术演进;\n- 主导大规模分布式系统的设计与落地;\n- 推动服务治理、稳定性与效率体系建设。\n\n任职要求:\n- 7 年以上经验,有大型分布式系统架构经验;\n- 精通 Go,深入理解系统设计与服务治理;\n- 有高并发、高可用系统建设经验;\n- 有团队技术影响力,能 Owner 关键方向。'},
  {id:11, co:'网易', role:'游戏服务端工程师', city:'杭州', kind:'独角兽/二线', status:'fav',
   interest:7.6, growth:6.5, match:7.5, chance:7.0, pay:'32-50万', src:'拉勾', years:'4+', edu:'本科+',
   need:['C++','高并发','MySQL','Redis','性能优化','Linux系统'], plus:['Go','分布式系统'],
   jd:'网易游戏服务端团队负责支撑大型多人在线游戏的后端。\n\n岗位职责:\n- 负责游戏服务端的研发,支撑高并发实时交互;\n- 优化服务端性能,保障游戏体验的稳定流畅;\n- 参与服务端架构设计与核心系统建设。\n\n任职要求:\n- 4 年以上服务端经验,精通 C++;\n- 有高并发、低延迟系统的性能优化经验;\n- 熟悉 MySQL / Redis 与 Linux 系统;\n- 有游戏 / 实时系统经验者优先。'},
  {id:12, co:'微软', role:'云平台工程师 · Azure', city:'北京', kind:'外企', status:'todo',
   interest:8.6, growth:8.0, match:6.5, chance:5.5, pay:'45-68万', src:'内推', years:'5+', edu:'本科+',
   need:['Rust','分布式系统','K8s','系统设计','Go','服务治理'], plus:['Docker','性能优化'],
   jd:'微软 Azure 云平台团队负责全球云基础设施的研发。\n\n岗位职责:\n- 负责云平台核心服务的设计与研发,用 Rust 构建高可靠系统;\n- 推动大规模分布式系统的稳定性与效率建设;\n- 参与全球化云服务的架构演进。\n\n任职要求:\n- 5 年以上经验,有较强的工程能力,熟悉 Rust 优先;\n- 深入理解分布式系统与系统设计;\n- 熟悉 K8s 云原生体系;\n- 英语可作为工作语言,有全球化系统经验优先。'}
];

/* skills: name, level 0-5, years, demandJobs (count 0-12), evidence[], priority */
export const SKILLS = [
  {name:'Go', lvl:4, years:8, demand:11, pri:'high', state:'已掌握', evidence:['美团核心配送后端','高并发 API 网关','服务治理平台']},
  {name:'MySQL', lvl:4, years:8, demand:10, pri:'mid', state:'已掌握', evidence:['大规模分库分表','慢查询优化体系','百亿级数据迁移','索引治理']},
  {name:'Redis', lvl:3, years:6, demand:9, pri:'mid', state:'已掌握', evidence:['多级缓存设计','分布式锁实现']},
  {name:'微服务', lvl:3, years:5, demand:8, pri:'mid', state:'已掌握', evidence:['美团核心业务拆分','服务治理实践']},
  {name:'高并发', lvl:4, years:7, demand:9, pri:'mid', state:'已掌握', evidence:['单服务 QPS 10w+','限流降级体系','热点数据治理']},
  {name:'分布式系统', lvl:2, years:3, demand:7, pri:'mid', state:'进行中', evidence:['微服务一致性设计']},
  {name:'系统设计', lvl:3, years:5, demand:8, pri:'mid', state:'已掌握', evidence:['配送调度系统设计','网关架构设计']},
  {name:'服务治理', lvl:3, years:5, demand:6, pri:'low', state:'已掌握', evidence:['全链路服务治理','熔断限流落地']},
  {name:'性能优化', lvl:3, years:6, demand:7, pri:'mid', state:'已掌握', evidence:['P99 从 200ms 到 80ms','JVM/GC 调优']},
  {name:'K8s', lvl:1, years:1, demand:8, pri:'high', state:'仅基础', evidence:['个人项目部署实践']},
  {name:'Rust', lvl:0, years:0, demand:6, pri:'high', state:'计划学习', evidence:[]},
  {name:'Docker', lvl:3, years:4, demand:4, pri:'low', state:'已掌握', evidence:['CI/CD 容器化','本地开发环境标准化']},
  {name:'Java', lvl:3, years:5, demand:5, pri:'low', state:'已掌握', evidence:['早期支付系统','JVM 调优实践']},
  {name:'gRPC', lvl:2, years:2, demand:4, pri:'low', state:'进行中', evidence:['内部 RPC 框架接入']},
  {name:'Kafka', lvl:2, years:3, demand:5, pri:'mid', state:'进行中', evidence:['异步解耦实践']},
  {name:'监控告警', lvl:3, years:5, demand:4, pri:'low', state:'已掌握', evidence:['全链路监控建设','告警分级体系']},
  {name:'Linux系统', lvl:3, years:8, demand:4, pri:'low', state:'已掌握', evidence:['性能排查工具链','内核参数调优']},
  {name:'DDD', lvl:1, years:1, demand:3, pri:'mid', state:'计划学习', evidence:[]},
  {name:'C++', lvl:1, years:2, demand:4, pri:'mid', state:'待补充', evidence:['学生时代项目']},
  {name:'Python', lvl:3, years:4, demand:2, pri:'low', state:'已掌握', evidence:['运维脚本','数据处理工具']},
  {name:'PostgreSQL', lvl:2, years:2, demand:2, pri:'low', state:'进行中', evidence:['迁移调研']},
  {name:'MongoDB', lvl:2, years:2, demand:1, pri:'low', state:'进行中', evidence:['日志存储实践']},
  {name:'RabbitMQ', lvl:2, years:2, demand:1, pri:'low', state:'已掌握', evidence:['任务队列实践']}
];

/* ---- 积累价值模型 ---- */
export const ACCRUAL = {
  compound:{label:'复利型', short:'复利', cls:'ac-compound', desc:'随经验复利增长,跨场景迁移,几乎不折旧 — 值得优先重投入。'},
  accumulate:{label:'积累型', short:'积累', cls:'ac-accumulate', desc:'稳定积累、基本不折旧,但增长接近线性 — 稳定维护即可。'},
  depreciate:{label:'易折旧', short:'折旧', cls:'ac-depreciate', desc:'与具体工具/版本绑定,折旧较快 — 够用即可,按需更新,别过度投入。'}
};
/* 专业技能的积累属性 (按名称映射) */
const TECH_META = {
  'Go':['accumulate','中','中'],'Java':['accumulate','中','中'],'Python':['accumulate','长','中'],
  'Rust':['accumulate','中','中'],'C++':['accumulate','长','中'],
  'MySQL':['accumulate','长','高'],'PostgreSQL':['accumulate','长','高'],'Redis':['accumulate','中','高'],
  'MongoDB':['accumulate','中','中'],'Kafka':['accumulate','中','中'],'RabbitMQ':['accumulate','中','中'],'gRPC':['accumulate','中','中'],
  'K8s':['depreciate','短','中'],'Docker':['depreciate','短','中'],'监控告警':['accumulate','中','中'],'Linux系统':['accumulate','长','高'],
  '微服务':['compound','长','高'],'分布式系统':['compound','长','高'],'服务治理':['compound','长','高'],
  '高并发':['compound','长','高'],'性能优化':['compound','长','高'],'DDD':['compound','长','高'],'系统设计':['compound','长','高']
};
SKILLS.forEach(s=>{ s.cat='tech'; const m=TECH_META[s.name]||['accumulate','中','中']; s.accrual=m[0]; s.halflife=m[1]; s.transfer=m[2]; });

/* ---- 通用能力 (transferable) ---- */
export const GENERAL = [
  {name:'沟通表达', cat:'general', lvl:3, years:8, demand:9, pri:'mid', state:'已掌握', accrual:'compound', halflife:'长', transfer:'高', evidence:['跨团队需求对齐与方案宣讲','技术方案评审主讲 20+ 次']},
  {name:'跨团队协作', cat:'general', lvl:4, years:8, demand:8, pri:'mid', state:'已掌握', accrual:'compound', halflife:'长', transfer:'高', evidence:['配送-商家-物流三方协同','大促保障跨团队联合作战']},
  {name:'项目管理', cat:'general', lvl:3, years:6, demand:6, pri:'mid', state:'已掌握', accrual:'compound', halflife:'长', transfer:'高', evidence:['主导核心链路重构排期','多人项目拆分与风险跟踪']},
  {name:'向上管理', cat:'general', lvl:2, years:4, demand:4, pri:'mid', state:'进行中', accrual:'compound', halflife:'长', transfer:'高', evidence:['季度 OKR 对齐与资源争取']},
  {name:'技术写作', cat:'general', lvl:3, years:5, demand:5, pri:'mid', state:'已掌握', accrual:'compound', halflife:'长', transfer:'高', evidence:['沉淀架构决策文档 (ADR)','结构化故障复盘报告']},
  {name:'演讲与分享', cat:'general', lvl:2, years:3, demand:3, pri:'low', state:'进行中', accrual:'compound', halflife:'长', transfer:'高', evidence:['团队内技术分享 6 次']},
  {name:'带人与团队建设', cat:'general', lvl:2, years:3, demand:4, pri:'mid', state:'进行中', accrual:'compound', halflife:'长', transfer:'高', evidence:['带 2 名新人独立承担模块']}
];
/* ---- 元能力 (meta) ---- */
export const META = [
  {name:'学习能力', cat:'meta', lvl:4, years:0, demand:10, pri:'high', state:'已掌握', accrual:'compound', halflife:'长', transfer:'高', evidence:['3 个月自学 Rust 到可用','快速上手陌生业务域']},
  {name:'系统思考', cat:'meta', lvl:3, years:0, demand:8, pri:'high', state:'进行中', accrual:'compound', halflife:'长', transfer:'高', evidence:['从全局视角定位性能瓶颈','权衡式架构决策']},
  {name:'复盘反思', cat:'meta', lvl:3, years:0, demand:6, pri:'mid', state:'已掌握', accrual:'compound', halflife:'长', transfer:'高', evidence:['每次线上故障结构化复盘','季度个人能力盘点']},
  {name:'抗压与情绪韧性', cat:'meta', lvl:3, years:0, demand:5, pri:'mid', state:'进行中', accrual:'compound', halflife:'长', transfer:'高', evidence:['大促高压期稳定输出']},
  {name:'好奇心与探索', cat:'meta', lvl:4, years:0, demand:4, pri:'mid', state:'已掌握', accrual:'compound', halflife:'长', transfer:'高', evidence:['持续跟进行业前沿','主动做技术预研']}
];
GENERAL.forEach(c=>SKILLS.push(c));
META.forEach(c=>SKILLS.push(c));
export const CAT_LABEL={tech:'专业技能', general:'通用能力', meta:'元能力'};

export const ACTIONS = [
  {id:1, title:'完成 Rust 实战项目 v0.2', state:'doing', pri:'high', fromJobs:6, due:'2026.05.31', skill:'Rust', cap:'Rust', jobs:'拼多多 / 微软 / 字节跳动', est:'', progress:45,
   goal:'能独立用 Rust 写出生产可用的高并发 KV 服务,并讲清所有权、生命周期与异步并发模型 — 形成一个可放进简历的开源项目。',
   milestones:[{t:'吃透所有权与生命周期',done:true},{t:'掌握 async / tokio 异步模型',done:true},{t:'实现核心 KV 存储引擎',done:false},{t:'压测并做性能调优',done:false},{t:'补 K8s 部署 + README',done:false}],
   sessions:[
     {date:'2026.05.12', mins:90, note:'过完《Rust 程序设计语言》所有权章节,手写借用检查器会报错的 5 个反例'},
     {date:'2026.05.15', mins:120, note:'实现简单 echo server,踩了 Arc/Mutex 的坑,弄清了 Send/Sync'},
     {date:'2026.05.19', mins:75, note:'tokio 异步任务调度,对比 Go goroutine 的心智模型差异'},
     {date:'2026.05.23', mins:110, note:'KV 存储 WAL 写入雏形,benchmark 还没跑'}
   ],
   reflection:'比预想难在「与编译器搏斗」的阶段,但一旦过了所有权这关,对内存与并发的理解明显加深 — 这部分认知能迁移回 Go/C++。下一步聚焦把存储引擎跑通,别陷进语法细节。'},
  {id:2, title:'整理"分布式系统"项目证据', state:'doing', pri:'high', fromJobs:7, due:'2026.05.25', skill:'分布式系统', cap:'分布式系统', jobs:'字节跳动 / 蚂蚁集团 / 滴滴', est:'', progress:60,
   goal:'把过往分布式相关经历提炼成 3 段可讲透的 STAR 证据,覆盖一致性、容错、扩展性三个维度,面试可随时调用。',
   milestones:[{t:'梳理一致性相关经历',done:true},{t:'梳理容错/降级经历',done:true},{t:'梳理水平扩展经历',done:false},{t:'写成 STAR 话术',done:false}],
   sessions:[
     {date:'2026.05.16', mins:60, note:'翻出配送调度的最终一致性方案,画了时序图'},
     {date:'2026.05.20', mins:80, note:'整理一次主从切换故障的处理过程,量化了影响面与恢复时长'}
   ],
   reflection:'证据的关键不是「做过」,而是能讲清「为什么这么权衡」。容错那段还缺一个量化指标,得回去翻监控数据。'},
  {id:3, title:'补充 K8s 生产部署经验', state:'doing', pri:'mid', fromJobs:8, due:'', skill:'K8s', cap:'K8s', jobs:'阿里巴巴 / 微软 / 美团', est:'2 周', progress:30, note:'在 Rust 项目中加入 K8s 部署',
   goal:'能独立把一个服务从 0 部署到 K8s 集群:写 Deployment/Service/Ingress,配好健康检查、滚动发布与基础监控。',
   milestones:[{t:'本地 kind 集群跑通',done:true},{t:'写 Deployment + Service',done:false},{t:'配置探针与滚动发布',done:false},{t:'接入基础监控',done:false}],
   sessions:[
     {date:'2026.05.21', mins:70, note:'kind 起本地集群,部署了个 nginx,理解了 Pod/Service/Endpoint 的关系'}
   ],
   reflection:'K8s 工具层更新很快(易折旧),所以重点放在「调度/网络/声明式」这些可迁移的概念上,具体 yaml 字段够用即查。'},
  {id:4, title:'更新简历至 v3', state:'todo', pri:'mid', fromJobs:0, due:'', skill:'', cap:'技术写作', jobs:'', est:'', note:'按"分布式""稳定性"高频词重写',
   goal:'让简历每段经历都对齐目标 JD 的高频词(稳定性/高并发/分布式),用量化结果替换职责描述。',
   milestones:[{t:'提取 12 份 JD 高频词',done:false},{t:'重写 3 段核心经历',done:false},{t:'找 1 位同行评审',done:false}],
   sessions:[], reflection:''},
  {id:5, title:'准备字节面试 · 系统设计专题', state:'todo', pri:'mid', fromJobs:0, due:'2026.05.28', skill:'系统设计', cap:'系统设计', jobs:'字节跳动', est:'',
   goal:'能在 45 分钟内完成一道开放式系统设计题:澄清需求 → 估算 → 画架构 → 讲权衡 → 谈演进。',
   milestones:[{t:'复盘 5 道经典题',done:false},{t:'练习容量估算',done:false},{t:'模拟面试 2 轮',done:false}],
   sessions:[], reflection:''},
  {id:6, title:'录入 5 个新岗位', state:'todo', pri:'low', fromJobs:0, due:'', skill:'', cap:'', jobs:'', est:'', note:'目标 20 · 当前 12',
   goal:'把目标岗位从 12 个补到 20 个,覆盖更多公司类型,让缺口分析更有代表性。',
   milestones:[{t:'列出 8 个候选公司',done:false},{t:'录入并打分',done:false}],
   sessions:[], reflection:''},
  {id:7, title:'补充 gRPC 实战经验', state:'todo', pri:'mid', fromJobs:4, due:'', skill:'gRPC', cap:'gRPC', jobs:'蚂蚁集团 / 阿里巴巴', est:'1 周',
   goal:'用 gRPC 改造 Rust 项目的内部通信,理解 proto 定义、流式、拦截器与超时重试。',
   milestones:[{t:'写 proto 并生成代码',done:false},{t:'实现双向流',done:false}],
   sessions:[], reflection:''},
  {id:8, title:'录入"美团 / 核心配送后端"', state:'done', pri:'mid', fromJobs:0, due:'2026.05.20', skill:'', cap:'', jobs:'美团', est:'', progress:100,
   goal:'完整录入美团核心配送后端岗位,粘贴 JD 并完成四维打分。',
   milestones:[{t:'粘贴完整 JD',done:true},{t:'抽取技能',done:true},{t:'四维打分',done:true}],
   sessions:[{date:'2026.05.20', mins:25, note:'录入并打分,匹配度意外地高,标记为重点跟进'}],
   reflection:'录入时顺手做了自我匹配,发现配送经历正好对口 — 这种「边录入边发现自己优势」的感觉很解焦虑。'}
];
export const PRI = {high:{label:'高',cls:'pl-high'}, mid:{label:'中',cls:'pl-mid'}, low:{label:'低',cls:'pl-low'}};

/* derived: top gaps for overview */
export const TOP_GAPS = [
  {rank:'01', name:'Rust 实战项目', jobs:6, have:0, pct:18, pri:'高'},
  {rank:'02', name:'分布式系统设计', jobs:7, have:'进行中', pct:40, pri:'中'},
  {rank:'03', name:'K8s 生产实战', jobs:8, have:'仅基础', pct:28, pri:'中'}
];
export const KEYWORDS = [
  ['稳定性',18],['高并发',15],['性能优化',14],['线上故障',12],['Owner',11],['推动',10],
  ['可用性',9],['0-1',8],['落地',8],['容量规划',7],['复盘',6],['演进',6],['治理',5]
];
export const PIPELINE = [
  {label:'收藏', n:5, color:'var(--status-info)'},
  {label:'待投', n:3, color:'var(--border-strong)'},
  {label:'已投', n:2, color:'var(--accent)'},
  {label:'面试', n:1, color:'var(--accent)'},
  {label:'拒绝', n:1, color:'var(--ink-mute)'},
  {label:'放弃', n:0, color:'var(--ink-mute)'}
];
const CITY_DIST = [['北京',6],['杭州',4],['上海',2],['深圳',1]];
const KIND_DIST = [['一线大厂',8],['独角兽/二线',2],['外企',1],['创业公司',0]];

/* ★批11B(widgetActions 契约):JOBS 桥已摘 —— 最后一个裸读者(platform/shell/widget-actions.js 的 delete-job 分支)已整段回迁 jobseek;全部消费者已 import。
   JOBS/SKILLS/ACTIONS 皆 mutated-property(.push/.length=0/.splice、hydration in-place)→ import 绑定即同一对象,跨文件 mutate 安全、免访问器;其余 const 只读。
   ★载序(第43轮判据:tag-order → **import 图自定序**):match/interview/resumes 顶层 `let state={jobId:JOBS[0].id}` 于 module-eval **急读 import 绑定**(不再是 window.JOBS 桥);
   data.js 位于 SCC 之外 ⇒ import 图保证其先求值、JOBS 就绪(JOBS[0] 非空由 mock 12 保证)。
   CITY_DIST/KIND_DIST/TECH_META 私有。 */