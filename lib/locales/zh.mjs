// 中文。这些字符串必须与 i18n 改造前的输出逐字节一致 —— 改造本身不应该改变任何人读到的内容。
// 键集合与 en.mjs 完全相同，test/i18n.test.mjs 会校验。
export default {
  // ---- 共用 ----
  'blame.user-data': '需要处理（你的数据）',
  'blame.descriptor': '本工具的描述符问题（可提 PR）',
  'blame.platform': '平台自身行为',
  'scope.user': '用户级',
  'scope.project': '项目/{key}',
  'common.reportTo': 'report -> {path}',

  // ---- 帮助 ----
  'cli.usage': `ai-memlint — 跨平台 AI 记忆审计器（只读）

用法: ai-memlint [命令] [选项]

命令:
  doctor       扫描并报告 findings（默认命令，零写入）
  platforms    列出描述符声明的位置，以及本机命中情况
  skills       技能清单；加 --to 生成迁移清单（只列命令，不执行）
  verify       信任面：零依赖 / 零网络出口 / 删除调用 / 源文件完整性
  harvest      物化可读 store（唯一默认写盘的命令；--out 另计）
  view         启动 loopback 查看器并打开浏览器

选项:
  --json               以 JSON 输出 report
  --platform=<id>      只报告该平台（可重复）
  --blame=<x>          只报告该归属：user-data | descriptor | platform（可重复）
  --to=<目标>          skills：迁移目标（平台 id 或技能目录）
  --from=<来源>        skills：只统计该来源目录，不给则统计其它全部目录
  --fail-on=<sev>      退出码阈值，默认 high；可选 medium|low|any|never
  --redact-paths       把绝对路径里的 home 重写为 ~（贴 issue 前用）
  --lang=<en|zh>       输出语言；默认跟随 AI_MEMLINT_LANG，其次系统区域设置
  --out[=<path>]       doctor/skills：把 report 写入文件；只写 --out 则用默认位置
                       （platforms/verify 忽略此选项）
  --no-color           关闭 ANSI 颜色
  --no-open            view 时不自动开浏览器
  --dry-run            harvest 试运行，不写盘
  --help               显示本帮助

退出码: 0 无阈值内 finding · 1 有 · 2 工具自身错误`,

  // ---- doctor ----
  'doctor.scan': '扫描根 {roots} · 形态命中 {shapes} · 已安装平台 {installed} · 有记忆 {withMemory} · 笔记 {notes} · {ms}ms',
  'doctor.dataRoot': '数据根 {path}',
  'doctor.dataRootOverride': ' (AI_MEMORY_HOME 覆盖)',
  'doctor.clean': '未发现问题。',
  'doctor.found': '发现 {total} 条',
  'doctor.byBlame': '按归属：你的数据 {userData} · 描述符 {descriptor} · 平台 {platform}',
  'doctor.zeroWriteWarning': '警告：doctor 改动了数据目录，违反零写入承诺',

  // ---- platforms ----
  'platforms.summary': '{count} 条描述符，本机命中 {installed}',
  'platforms.summaryCustom': '，其中自定义 {n}',
  'platforms.customBadge': '[自定义] ',
  'platforms.declared': '    声明: {roots}',
  'platforms.memory': '    记忆: {scopes}',
  'platforms.local': '    本机: {roots}  笔记={notes}',
  'platforms.note': '    备注: {note}',
  'platforms.choices': '可选值:',

  // ---- skills：迁移清单 ----
  'skills.migrateTitle': 'ai-memlint skills — 迁移清单',
  'skills.target': '目标  {label}  {rel}  现有 {count} 个技能',
  'skills.source': '来源  {label}  {rel}',
  'skills.counts': '统计  待复制 {missing} · 已存在 {same} · 冲突 {conflict} · 合计 {total}',
  'skills.prepare': '准备  $ {cmd}',
  'skills.state.missing': '待复制',
  'skills.state.conflict': '冲突',
  'skills.state.same': '已存在',
  'skills.copies': ' ×{n} 份副本',
  'skills.from': '       来自 {rel}  {hash}  {size}',
  'skills.current': '       目标 {rel}  {hash}',
  'skills.sourceOnlyTag': '  (仅可作为来源)',

  // ---- skills：清单 ----
  'skills.inventorySummary': '{count} 个技能 · {dirs} 个技能目录',
  'skills.targetsHeading': '可迁移目标（--to）:',
  'skills.sourceOnlyHeading': '仅可作为来源（应用自带或工作区目录，非安装位置）:',
  'skills.unit': '{n} 个',
  'skills.footer': '迁移清单: skills --to=<目标> [--from=<来源>]；本命令只读，不复制任何文件。',

  // ---- verify ----
  'verify.sourceFiles': '{n} 个源文件',
  'verify.pass': '通过',
  'verify.fail': '未通过',
  'verify.zeroDeps': '零依赖        package.json={pkg} · node_modules={nm} · 外部 import={ext}',
  'verify.pkgWithDeps': '有 · 声明依赖 {n} 个',
  'verify.pkgNone': '无',
  'verify.yes': '有',
  'verify.no': '无',
  'verify.parseError': '      package.json 无法解析：{err}',
  'verify.zeroEgress': '零网络出口    Node 侧出站 API={node} · 外部 origin 引用={origins} · 监听绑定={listens} 处{loopback}',
  'verify.loopback': '（全部 loopback）',
  'verify.deleteCalls': '删除调用      {n} 处',
  'verify.writeCalls': '      写入调用      {n} 处',
  'verify.integrity': '源文件完整性  {files} 个文件，两次扫描间 sha256 {state}',
  'verify.identical': '全部一致',
  'verify.changed': '有变动',
  'verify.zeroWrite': 'doctor 零写入 数据目录{state}',
  'verify.unchanged': '内容未变',
  'verify.notCreated': '未被创建',
  'verify.changedFiles': '  变动的源文件:',
  'verify.note': '  这些是证据行，供人工复核；verify 不代替审计。',
  'verify.ev.nodeEgress': 'Node 侧出站 API',
  'verify.ev.origins': '外部 origin 引用',
  'verify.ev.listens': '监听绑定',
  'verify.ev.deletes': '删除调用',
  'verify.ev.writes': '写入调用',

  // ---- findings：标题与修复建议 ----
  'finding.credential-plaintext.title': '记忆文件中含明文凭据',
  'finding.credential-plaintext.fix': '立即轮换 {marks}。该文件不会被复制进数据目录，工具只记录路径与规则名。',
  'finding.credential-sensitive.title': '记忆文件中含敏感标识符',
  'finding.credential-sensitive.fix': '命中 {marks}。查看时遮蔽渲染；源目录原文未改动。',
  'finding.orphan-note.title': '笔记未被索引引用，检索永远取不到',
  'finding.orphan-note.fix': '把 {subject} 加进 {index}，否则平台不会加载这条记忆。',
  'finding.note-unreadable.title': '记忆文件无法读取',
  'finding.note-unreadable.fix': '读取 {subject} 失败（{error}）。扫描跳过该文件而非中断。',
  'finding.index-dangling-link.title': '索引指向不存在的文件',
  'finding.index-dangling-link.fix': '{index} 引用了 {count} 个不存在的文件：{items}。',
  'finding.conflict-cross-platform.title': '多平台同键记忆内容不一致',
  'finding.conflict-cross-platform.fix': '{subject} 在 {owners} 中内容不同。工具不自动合并，需人工裁决。',
  'finding.frontmatter-missing.title': '笔记缺少 frontmatter',
  'finding.frontmatter-missing.fix': '{count} 条笔记没有 frontmatter，description 无法用于相关性判断：{items}。',
  'finding.descriptor-gap.title': '已知平台内存在未覆盖的记忆目录',
  'finding.descriptor-gap.fix': '{subject} 归属 {platform} 但描述符未声明。补 lib/registry.mjs 即可，欢迎 PR。',
  'finding.shape-unattributed.title': '疑似记忆，无对应描述符',
  'finding.shape-unattributed.fix': '{subject} 形态像记忆但不属于任何已知平台，工具不解析它。',
  'finding.index-missing.title': '描述符声明的索引文件不存在',
  'finding.index-missing.fix': '描述符称 {platform} 应有 {index}，但该处有 {count} 条笔记而无索引。可能是描述符过期。',
  'finding.memory-empty.title': '记忆目录存在但为空',
  'finding.memory-empty.fix': '{subject} 已创建但没有任何笔记。',
  'finding.index-header-mismatch.title': '索引 header 与描述符不符',
  'finding.index-header-mismatch.fix': '描述符期望{expected}，实际{actual}。多为同厂商不同通道的格式差异，改描述符而非改数据。',
  'finding.note-vanished.title': '上次见过、本次消失的笔记',
  'finding.note-vanished.fix': '{count} 条笔记自上次扫描后不再出现在任何源通道：{items}。',

  // ---- 迁移报告 ----
  'migrate.sensitive': '来源含敏感内容（{level}{rules}）— 先处理凭据再复制',
  'migrate.sensitiveRules': ': {rules}',
  'migrate.noManifestName': '来源 SKILL.md 没有 frontmatter name，目标平台可能不识别',
  'migrate.nameMismatch': '目录名 {name} 与 frontmatter name {manifestName} 不一致',
  'migrate.nested': '目录内还有 {n} 个嵌套技能，会一并复制',
  'migrate.majority': '{copies} 份副本中有 {diff} 份内容不同，已选多数版本',
  'migrate.conflict': '目标已有同名技能但内容不同（{current} vs {chosen}）— 不要直接覆盖，先比对',
  'migrate.note': '以上命令仅为清单；本工具不会执行任何复制或移动。Windows 下可在 Git Bash 中运行。',
  'migrate.errTarget': '未知的迁移目标：{key}',
  'migrate.errSource': '未知的来源：{key}',
  'migrate.errSame': '来源与目标是同一个目录',

  // ---- 自定义平台 ----
  'custom.errArray': 'platforms 必须是数组',
  'custom.errMax': '自定义平台最多 {n} 个',
  'custom.errLabel': '名称必须为 1-60 个字符',
  'custom.errRoots': '{label}: 根目录需 1-{max} 个',
  'custom.errAbsolute': '{label}: 根目录需为绝对路径或 ~ 开头（收到 {root}）',
  'custom.errDotDotRoot': '{label}: 根目录不允许 .. 段',
  'custom.errDotDotMemory': '{label}: 记忆子目录不允许 .. 段',
  'custom.errIndex': '{label}: 索引应为文件名，不含路径',
};
