/**
 * README 段落替换：把 XML 章节改为 CSV 流程。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'README.md';
const lines = readFileSync(path, 'utf8').split('\n');

const start = lines.findIndex((l) => l.startsWith('### 2. 标签 XML'));
const end = lines.findIndex((l) => l.startsWith('## 项目结构'));
if (start === -1 || end === -1) throw new Error('未找到章节边界');

const replacement = `### 2. 标签 CSV（\`*_local_labels.csv\` / \`Global.csv\`）—— 直接导入

格式与 GX Works3 导出的标签文件**逐行逐列一致**（TAB 分隔、UTF-16 + BOM）。
导入路径：

- 局部标签：程序/FB 右键 → **局部标签** → **导入文件** → 选 \`Main_local_labels.csv\`
- 全局标签：**全局标签** → 右键 → **导入文件** → 选 \`Global.csv\`

### 3. 标签录入表（\`Main_labels.txt\`）—— 备选

\`\`\`text
(* FB_Motor —— 在「标签设置」工作表按此表逐行录入
   方向    标签名              数据类型   初始值   软元件     注释
   输入    bEnable             BOOL                         启动命令
   输出    bRunning            BOOL                         运行状态
   局部    tRampTimer          TON                          斜坡定时器
   局部    nRampStep           INT          0              斜坡步进
*)
\`\`\`

---

## 关于「工程 → 导入 → IEC61131-10 XML格式」

这个功能确实存在，但导入后**程序内容为空**，不能用于本工作流。

原因：它用的是 Mitsubishi 私有变体（\`www.iec.ch/public/TC65SC65BWG7TF10\`），
结构是 \`Types/GlobalNamespace/Program\` + \`Vars/Parameters\` + \`MainBody/BodyContent\`。
GX Works3 的导入器在这个路径下没有把 ST 主体与标签表关联起来。

而且**标签根本不能通过这个菜单导入** —— 标签菜单只接受 CSV，XML 仅支持导出。

所以本工具的路径是：标签用 CSV 导入，ST 本体用文本粘贴。

---

`;

const out = [...lines.slice(0, start), ...replacement.split('\n'), ...lines.slice(end)];
writeFileSync(path, out.join('\n'), 'utf8');
console.log('README 已更新');
