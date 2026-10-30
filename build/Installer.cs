// Nova Launcher 安装程序（C# 5 / WinForms，用系统自带 csc.exe 编译）
// 编译：csc /target:winexe /out:... /resource:payload.zip,payload.zip Installer.cs
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace NovaSetup
{
    static class Cfg
    {
        public const string AppName = "Nova Launcher";
        public const string AppTitle = "新星启动器";
        public const string Version = "1.0.0";
        public const string Publisher = "Nova Launcher";
        public const string RegKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\NovaLauncher";
        public const string ResourceName = "payload.zip";

        // 配色（和启动器本体一致）
        public static readonly Color Bg = Color.FromArgb(11, 13, 21);
        public static readonly Color Card = Color.FromArgb(18, 20, 29);
        public static readonly Color Stroke = Color.FromArgb(42, 46, 60);
        public static readonly Color Text = Color.FromArgb(233, 236, 246);
        public static readonly Color TextDim = Color.FromArgb(152, 161, 182);
        public static readonly Color TextMute = Color.FromArgb(98, 108, 130);
        public static readonly Color AccentA = Color.FromArgb(124, 58, 237);
        public static readonly Color AccentB = Color.FromArgb(6, 182, 212);
        public static readonly Color Ok = Color.FromArgb(52, 211, 153);
        public static readonly Color Bad = Color.FromArgb(251, 113, 133);

        public static string DefaultDir
        {
            get
            {
                string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(local, "NovaLauncher");
            }
        }

        public static bool HasFlag(string[] args, string flag)
        {
            foreach (string a in args)
                if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }
    }

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool uninstall = Cfg.HasFlag(args, "/UNINSTALL") || Cfg.HasFlag(args, "--uninstall") || Cfg.HasFlag(args, "/u");
            bool silent = Cfg.HasFlag(args, "/S") || Cfg.HasFlag(args, "--silent");

            if (uninstall)
            {
                Uninstaller.Run(silent);
                return;
            }

            // 静默安装：不开窗体，直接装完退出（返回码 0 = 成功）
            if (silent)
            {
                int code = 0;
                try
                {
                    Installer.Run(Cfg.DefaultDir, true, true, delegate (int p, string s) { });
                }
                catch (Exception ex)
                {
                    code = 1;
                    try
                    {
                        File.WriteAllText(Path.Combine(Path.GetTempPath(), "nova_setup_error.log"), ex.ToString());
                    }
                    catch { }
                }
                Environment.Exit(code);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    /* ------------------------------------------------------- 安装核心逻辑 */

    static class Installer
    {
        public static void Run(string dir, bool desktop, bool startMenu, Action<int, string> report)
        {
            string temp = Path.Combine(Path.GetTempPath(), "nova_setup_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            try
            {
                report(2, "准备安装目录 ...");
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                Directory.CreateDirectory(temp);

                // 1) 取出内嵌的 payload
                report(6, "释放安装文件 ...");
                string payload = Path.Combine(temp, "payload.zip");
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(Cfg.ResourceName))
                {
                    if (s == null) throw new Exception("安装包损坏：找不到内嵌资源");
                    using (FileStream fs = new FileStream(payload, FileMode.Create, FileAccess.Write))
                    {
                        byte[] buf = new byte[81920];
                        int n;
                        long total = s.Length, done = 0;
                        while ((n = s.Read(buf, 0, buf.Length)) > 0)
                        {
                            fs.Write(buf, 0, n);
                            done += n;
                            report(6 + (int)(16.0 * done / Math.Max(1, total)), "释放安装文件 ...");
                        }
                    }
                }

                report(24, "解包 ...");
                string unpack = Path.Combine(temp, "unpack");
                ZipFile.ExtractToDirectory(payload, unpack);

                // 2) 复制程序文件
                report(30, "安装启动器文件 ...");
                string srcApp = Path.Combine(unpack, "app");
                string dstApp = Path.Combine(dir, "app");
                if (Directory.Exists(dstApp)) Directory.Delete(dstApp, true);
                CopyDir(srcApp, dstApp);

                // 桌面外壳 + WebView2 依赖（放在安装根目录，与 app 同级）
                report(42, "安装桌面窗口组件 ...");
                foreach (string ship in new string[] {
                    "NovaLauncher.exe",
                    "Microsoft.Web.WebView2.Core.dll",
                    "Microsoft.Web.WebView2.WinForms.dll",
                    "WebView2Loader.dll" })
                {
                    string s = Path.Combine(unpack, ship);
                    if (File.Exists(s)) File.Copy(s, Path.Combine(dir, ship), true);
                }
                report(46, "启动器文件已就位");

                // 3) 安装 Node 运行时
                report(50, "安装 Node 运行时（约 90 MB，请稍候）...");
                string nodeZip = Path.Combine(unpack, "node.zip");
                string rtDir = Path.Combine(dir, "runtime");
                if (!Directory.Exists(rtDir)) Directory.CreateDirectory(rtDir);
                string nodeExe = Path.Combine(rtDir, "node.exe");
                using (ZipArchive za = ZipFile.OpenRead(nodeZip))
                {
                    ZipArchiveEntry entry = null;
                    foreach (ZipArchiveEntry e in za.Entries)
                    {
                        if (e.FullName.EndsWith("/node.exe", StringComparison.OrdinalIgnoreCase))
                        {
                            entry = e;
                            break;
                        }
                    }
                    if (entry == null) throw new Exception("运行时压缩包中找不到 node.exe");
                    if (File.Exists(nodeExe)) File.Delete(nodeExe);
                    using (Stream ins = entry.Open())
                    using (FileStream outs = new FileStream(nodeExe, FileMode.Create, FileAccess.Write))
                    {
                        byte[] buf = new byte[81920];
                        int n;
                        long done = 0;
                        long total = entry.Length;
                        while ((n = ins.Read(buf, 0, buf.Length)) > 0)
                        {
                            outs.Write(buf, 0, n);
                            done += n;
                            report(50 + (int)(34.0 * done / Math.Max(1, total)), "安装 Node 运行时 ...");
                        }
                    }
                }
                report(85, "运行时安装完成");

                // 4) 生成启动脚本 + 数据目录标记
                report(88, "生成启动脚本 ...");
                WriteLauncher(dir);
                WriteUninstallStub(dir);
                // 让数据目录固定落在程序目录外（app\..\data），
                // 这样无论用快捷方式还是直接跑 node，都不会把 data 建到 app 里面
                try
                {
                    File.WriteAllText(Path.Combine(dstApp, ".nova-data-dir"), "..\\data", new System.Text.UTF8Encoding(false));
                }
                catch { }

                // 5) 图标
                string icoPath = Path.Combine(dir, "nova.ico");
                try
                {
                    using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("nova.ico"))
                    {
                        if (s != null)
                        {
                            using (FileStream fs = new FileStream(icoPath, FileMode.Create, FileAccess.Write)) s.CopyTo(fs);
                        }
                    }
                }
                catch { }

                // 6) 快捷方式
                report(93, "创建快捷方式 ...");
                // 默认指向桌面外壳（独立窗口，不依赖浏览器）；缺失时退回命令行入口
                string target = Path.Combine(dir, "NovaLauncher.exe");
                if (!File.Exists(target)) target = Path.Combine(dir, "Nova Launcher.cmd");
                if (desktop)
                {
                    string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    CreateShortcut(Path.Combine(desktopPath, "Nova Launcher.lnk"), target, dir, icoPath, "Nova Launcher - Minecraft 启动器");
                }
                if (startMenu)
                {
                    string prog = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                    string menuDir = Path.Combine(prog, "Nova Launcher");
                    if (!Directory.Exists(menuDir)) Directory.CreateDirectory(menuDir);
                    CreateShortcut(Path.Combine(menuDir, "Nova Launcher.lnk"), target, dir, icoPath, "Nova Launcher - Minecraft 启动器");
                    CreateShortcut(Path.Combine(menuDir, "卸载 Nova Launcher.lnk"), Path.Combine(dir, "Uninstall.cmd"), dir, icoPath, "卸载 Nova Launcher");
                }

                // 7) 注册表卸载信息
                report(96, "写入系统注册表 ...");
                WriteRegistry(dir, icoPath);

                report(100, "安装完成");
            }
            finally
            {
                try { if (Directory.Exists(temp)) Directory.Delete(temp, true); } catch { }
            }
        }

        static void CopyDir(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (string f in Directory.GetFiles(from))
                File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
            foreach (string d in Directory.GetDirectories(from))
                CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
        }

        static void WriteLauncher(string dir)
        {
            string cmd =
                "@echo off\r\n" +
                "chcp 65001 >nul\r\n" +
                "title Nova Launcher (命令行模式)\r\n" +
                "setlocal\r\n" +
                "rem 这是排查问题用的命令行入口。\r\n" +
                "rem 正常请用桌面快捷方式 NovaLauncher.exe（独立窗口，不需要浏览器）。\r\n" +
                "set \"NOVA_DATA_DIR=%~dp0data\"\r\n" +
                "cd /d \"%~dp0app\"\r\n" +
                "if not exist \"%~dp0runtime\\node.exe\" (\r\n" +
                "  echo 运行时缺失，请重新安装。\r\n" +
                "  pause\r\n" +
                "  exit /b 1\r\n" +
                ")\r\n" +
                "echo 命令行模式：启动本地服务后会打开默认浏览器。\r\n" +
                "echo 如果要独立窗口，请直接运行 NovaLauncher.exe。\r\n" +
                "echo.\r\n" +
                "\"%~dp0runtime\\node.exe\" \"%~dp0app\\server\\index.mjs\"\r\n" +
                "if errorlevel 1 (\r\n" +
                "  echo.\r\n" +
                "  echo 启动器已退出。若端口被占用，可先执行: set NOVA_PORT=7500\r\n" +
                "  pause\r\n" +
                ")\r\n";
            // 用 UTF-8（无 BOM）配合 chcp 65001，中文提示才不会乱码
            File.WriteAllText(Path.Combine(dir, "Nova Launcher.cmd"), cmd, new System.Text.UTF8Encoding(false));
        }

        static void WriteUninstallStub(string dir)
        {
            string fallback =
                "@echo off\r\n" +
                "chcp 65001 >nul\r\n" +
                "title 卸载 Nova Launcher\r\n" +
                "echo 正在卸载 Nova Launcher ...\r\n" +
                "echo.\r\n" +
                "echo 注意：游戏数据（下载的版本、模组、存档）会保留在:\r\n" +
                "echo   %~dp0data\r\n" +
                "echo 如需彻底删除，请安装完成后手动删除整个目录。\r\n" +
                "echo.\r\n" +
                "choice /c YN /n /m \"确认卸载程序文件？(Y/N) \"\r\n" +
                "if errorlevel 2 exit /b 0\r\n" +
                "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NovaLauncher\" /f >nul 2>nul\r\n" +
                "del /q \"%USERPROFILE%\\Desktop\\Nova Launcher.lnk\" >nul 2>nul\r\n" +
                "rd /s /q \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Nova Launcher\" >nul 2>nul\r\n" +
                "rd /s /q \"%~dp0app\" >nul 2>nul\r\n" +
                "rd /s /q \"%~dp0runtime\" >nul 2>nul\r\n" +
                "del /q \"%~dp0Nova Launcher.cmd\" >nul 2>nul\r\n" +
                "del /q \"%~dp0Uninstall.cmd\" >nul 2>nul\r\n" +
                "del /q \"%~dp0nova.ico\" >nul 2>nul\r\n" +
                "echo.\r\n" +
                "echo 卸载完成。游戏数据仍保留在 %~dp0data\r\n" +
                "pause\r\n";
            File.WriteAllText(Path.Combine(dir, "Uninstall.cmd"), fallback, new System.Text.UTF8Encoding(false));
        }

        /// <summary>用 COM 的 WScript.Shell 建快捷方式（避免额外的 interop 引用）</summary>
        public static void CreateShortcut(string lnkPath, string target, string workDir, string icon, string desc)
        {
            try
            {
                Type t = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(t);
                object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                Type lt = lnk.GetType();
                lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
                lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workDir });
                lt.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { desc });
                if (!string.IsNullOrEmpty(icon) && File.Exists(icon))
                    lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { icon + ",0" });
                lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            }
            catch { /* 快捷方式失败不影响安装 */ }
        }

        static void WriteRegistry(string dir, string icoPath)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Cfg.RegKey))
                {
                    k.SetValue("DisplayName", Cfg.AppName + " (" + Cfg.AppTitle + ")");
                    k.SetValue("DisplayVersion", Cfg.Version);
                    k.SetValue("Publisher", Cfg.Publisher);
                    k.SetValue("InstallLocation", dir);
                    k.SetValue("DisplayIcon", File.Exists(icoPath) ? icoPath : Path.Combine(dir, "Nova Launcher.cmd"));
                    k.SetValue("UninstallString", "\"" + Path.Combine(dir, "Uninstall.cmd") + "\"");
                    k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    long size = 0;
                    try
                    {
                        foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                            size += new FileInfo(f).Length;
                    }
                    catch { }
                    k.SetValue("EstimatedSize", (int)(size / 1024), RegistryValueKind.DWord);
                }
            }
            catch { }
        }
    }

    /* --------------------------------------------------------------- 卸载 */

    static class Uninstaller
    {
        public static void Run(bool silent)
        {
            string dir = Cfg.DefaultDir;
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(Cfg.RegKey))
                {
                    if (k != null)
                    {
                        object loc = k.GetValue("InstallLocation");
                        if (loc != null && loc.ToString().Length > 0) dir = loc.ToString();
                    }
                }
            }
            catch { }

            if (!silent)
            {
                DialogResult r = MessageBox.Show(
                    "确定要卸载 " + Cfg.AppName + " 吗？\r\n\r\n" +
                    "程序文件会被删除，但游戏数据（下载的版本、模组、存档）会保留在：\r\n" + Path.Combine(dir, "data") +
                    "\r\n\r\n如需彻底清理，卸载后手动删除该目录即可。",
                    "卸载 " + Cfg.AppName,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (r != DialogResult.Yes) return;
            }

            try { Registry.CurrentUser.DeleteSubKeyTree(Cfg.RegKey, false); } catch { }

            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string lnk = Path.Combine(desktop, "Nova Launcher.lnk");
                if (File.Exists(lnk)) File.Delete(lnk);
            }
            catch { }
            try
            {
                string prog = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Nova Launcher");
                if (Directory.Exists(prog)) Directory.Delete(prog, true);
            }
            catch { }

            try
            {
                string app = Path.Combine(dir, "app");
                string rt = Path.Combine(dir, "runtime");
                if (Directory.Exists(app)) Directory.Delete(app, true);
                if (Directory.Exists(rt)) Directory.Delete(rt, true);
                foreach (string f in new string[] {
                    "Nova Launcher.cmd", "Uninstall.cmd", "nova.ico",
                    "NovaLauncher.exe",
                    "Microsoft.Web.WebView2.Core.dll",
                    "Microsoft.Web.WebView2.WinForms.dll",
                    "WebView2Loader.dll" })
                {
                    string p = Path.Combine(dir, f);
                    if (File.Exists(p)) { try { File.Delete(p); } catch { } }
                }
            }
            catch { }

            if (!silent)
                MessageBox.Show("卸载完成。\r\n\r\n游戏数据保留在：\r\n" + Path.Combine(dir, "data"),
                    "卸载 " + Cfg.AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    /* ------------------------------------------------------------ 安装界面 */

    class SetupForm : Form
    {
        private TextBox _path;
        private CheckBox _desktop;
        private CheckBox _startMenu;
        private CheckBox _launch;
        private Button _install;
        private Button _cancel;
        private GradientPanel _header;
        private Bar _bar;
        private Label _status;
        private bool _busy;

        public SetupForm()
        {
            InitUi();
        }

        // 让标题栏也跟着变深色（Windows 10 2004+ 支持）
        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                int dark = 1;
                DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));   // DWMWA_USE_IMMERSIVE_DARK_MODE
            }
            catch { }
        }

        private void InitUi()
        {
            Text = Cfg.AppName + " 安装程序";
            ClientSize = new Size(680, 468);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Cfg.Bg;
            ForeColor = Cfg.Text;
            Font = new Font("Microsoft YaHei UI", 9f);
            DoubleBuffered = true;

            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("nova.ico"))
                    if (s != null) Icon = new Icon(s);
            }
            catch { }

            // 顶部渐变头
            _header = new GradientPanel();
            _header.Bounds = new Rectangle(0, 0, 680, 96);
            Controls.Add(_header);

            Label t1 = new Label();
            t1.Text = "Nova Launcher";
            t1.Font = new Font("Microsoft YaHei UI", 20f, FontStyle.Bold);
            t1.ForeColor = Color.White;
            t1.AutoSize = true;
            t1.BackColor = Color.Transparent;
            t1.Location = new Point(32, 22);
            _header.Controls.Add(t1);

            Label t2 = new Label();
            t2.Text = "新星启动器 · 安装程序   v" + Cfg.Version;
            t2.Font = new Font("Microsoft YaHei UI", 9f);
            t2.ForeColor = Color.FromArgb(225, 220, 255);
            t2.AutoSize = true;
            t2.BackColor = Color.Transparent;
            t2.Location = new Point(35, 60);
            _header.Controls.Add(t2);

            // 安装路径
            Label lp = new Label();
            lp.Text = "安装位置";
            lp.ForeColor = Cfg.TextDim;
            lp.AutoSize = true;
            lp.Location = new Point(34, 122);
            Controls.Add(lp);

            _path = new TextBox();
            _path.Text = Cfg.DefaultDir;
            _path.Bounds = new Rectangle(34, 145, 500, 28);
            _path.BackColor = Color.FromArgb(26, 29, 40);
            _path.ForeColor = Cfg.Text;
            _path.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(_path);

            Button browse = MakeButton("浏览...", false);
            browse.Bounds = new Rectangle(544, 144, 100, 30);
            browse.Click += delegate
            {
                using (FolderBrowserDialog d = new FolderBrowserDialog())
                {
                    d.Description = "选择安装位置";
                    if (Directory.Exists(_path.Text)) d.SelectedPath = _path.Text;
                    if (d.ShowDialog() == DialogResult.OK) _path.Text = Path.Combine(d.SelectedPath, "NovaLauncher");
                }
            };
            Controls.Add(browse);

            // 选项卡片
            Panel card = new Panel();
            card.Bounds = new Rectangle(34, 196, 610, 120);
            card.BackColor = Cfg.Card;
            card.Paint += delegate (object s, PaintEventArgs e)
            {
                using (Pen p = new Pen(Cfg.Stroke)) e.Graphics.DrawRectangle(p, 0, 0, card.Width - 1, card.Height - 1);
            };
            Controls.Add(card);

            _desktop = MakeCheck("创建桌面快捷方式", 18);
            _startMenu = MakeCheck("添加到开始菜单", 50);
            _launch = MakeCheck("安装完成后立即启动 Nova Launcher", 82);
            _desktop.Checked = true;
            _startMenu.Checked = true;
            _launch.Checked = true;
            card.Controls.Add(_desktop);
            card.Controls.Add(_startMenu);
            card.Controls.Add(_launch);

            // 说明
            Label tip = new Label();
            tip.Text = "自带运行环境与桌面窗口组件，装完就是独立应用，不需要浏览器。游戏数据保存在安装目录下的 data 文件夹。";
            tip.ForeColor = Cfg.TextMute;
            tip.Bounds = new Rectangle(34, 328, 610, 20);
            tip.AutoSize = false;
            Controls.Add(tip);

            // 进度条
            _bar = new Bar();
            _bar.Bounds = new Rectangle(34, 360, 610, 6);
            _bar.Visible = false;
            Controls.Add(_bar);

            _status = new Label();
            _status.Text = "";
            _status.ForeColor = Cfg.TextDim;
            _status.Bounds = new Rectangle(34, 372, 610, 22);
            Controls.Add(_status);

            // 按钮
            _cancel = MakeButton("取消", false);
            _cancel.Bounds = new Rectangle(446, 412, 92, 34);
            _cancel.Click += delegate { if (!_busy) Close(); };
            Controls.Add(_cancel);

            _install = MakeButton("立即安装", true);
            _install.Bounds = new Rectangle(546, 412, 98, 34);
            _install.Click += delegate { StartInstall(); };
            Controls.Add(_install);
        }

        private CheckBox MakeCheck(string text, int y)
        {
            CheckBox c = new CheckBox();
            c.Text = text;
            c.ForeColor = Cfg.Text;
            c.BackColor = Cfg.Card;
            c.AutoSize = true;
            c.Location = new Point(18, y + 6);
            c.FlatStyle = FlatStyle.Flat;   // Flat 才会应用自定义前景色
            c.Cursor = Cursors.Hand;
            return c;
        }

        private Button MakeButton(string text, bool primary)
        {
            Button b = new Button();
            b.Text = text;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 1;
            b.Font = new Font("Microsoft YaHei UI", 9f, primary ? FontStyle.Bold : FontStyle.Regular);
            if (primary)
            {
                b.BackColor = Cfg.AccentA;
                b.ForeColor = Color.White;
                b.FlatAppearance.BorderColor = Cfg.AccentA;
            }
            else
            {
                b.BackColor = Color.FromArgb(30, 33, 44);
                b.ForeColor = Cfg.TextDim;
                b.FlatAppearance.BorderColor = Cfg.Stroke;
            }
            b.UseVisualStyleBackColor = false;
            b.Cursor = Cursors.Hand;
            return b;
        }

        private void StartInstall()
        {
            if (_busy) return;
            string dir = _path.Text.Trim();
            if (dir.Length == 0)
            {
                MessageBox.Show("请选择安装位置。", Cfg.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            try { dir = Path.GetFullPath(dir); }
            catch
            {
                MessageBox.Show("安装路径无效。", Cfg.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            _busy = true;
            _install.Enabled = false;
            _cancel.Text = "后台安装";
            _bar.Visible = true;
            _bar.Value = 0;
            _status.Text = "开始安装 ...";
            _status.ForeColor = Cfg.TextDim;

            bool desktop = _desktop.Checked;
            bool startMenu = _startMenu.Checked;
            bool launch = _launch.Checked;

            Thread th = new Thread(delegate ()
            {
                try
                {
                    Installer.Run(dir, desktop, startMenu, delegate (int p, string s)
                    {
                        Report(p, s);
                    });
                    Report(100, "安装完成");
                    this.BeginInvoke((MethodInvoker)delegate
                    {
                        _busy = false;
                        _status.Text = "安装完成 — " + dir;
                        _status.ForeColor = Cfg.Ok;
                        _install.Text = "完成";
                        _install.Enabled = true;
                        _cancel.Enabled = false;
                        if (launch)
                        {
                            string cmd = Path.Combine(dir, "Nova Launcher.cmd");
                            if (File.Exists(cmd))
                            {
                                try
                                {
                                    ProcessStartInfo psi = new ProcessStartInfo(cmd);
                                    psi.WorkingDirectory = dir;
                                    psi.UseShellExecute = true;
                                    Process.Start(psi);
                                }
                                catch { }
                            }
                        }
                        Close();
                    });
                }
                catch (Exception ex)
                {
                    this.BeginInvoke((MethodInvoker)delegate
                    {
                        _busy = false;
                        _install.Enabled = true;
                        _cancel.Enabled = true;
                        _cancel.Text = "关闭";
                        _status.Text = "安装失败：" + ex.Message;
                        _status.ForeColor = Cfg.Bad;
                        MessageBox.Show("安装失败：\r\n" + ex.Message, Cfg.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    });
                }
            });
            th.IsBackground = true;
            th.Start();
        }

        private void Report(int percent, string status)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke((MethodInvoker)delegate { Apply(percent, status); });
                }
                else Apply(percent, status);
            }
            catch { }
        }

        private void Apply(int percent, string status)
        {
            if (_bar == null) return;
            if (percent < 0) percent = 0;
            if (percent > 100) percent = 100;
            _bar.Value = percent;
            if (status != null) _status.Text = status + "   " + percent + "%";
        }
    }

    /* --------------------------------------------------------- 自绘控件 */

    /// <summary>顶部渐变面板</summary>
    class GradientPanel : Panel
    {
        public GradientPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            Rectangle r = ClientRectangle;
            using (LinearGradientBrush b = new LinearGradientBrush(
                new Rectangle(0, 0, Math.Max(1, r.Width), Math.Max(1, r.Height)),
                Cfg.AccentA, Cfg.AccentB, 12f))
            {
                e.Graphics.FillRectangle(b, r);
            }
            // 右下角柔光
            using (SolidBrush g = new SolidBrush(Color.FromArgb(30, 255, 255, 255)))
            {
                e.Graphics.FillEllipse(g, r.Width - 210, -70, 260, 190);
            }
            base.OnPaint(e);
        }
    }

    /// <summary>渐变进度条</summary>
    class Bar : Control
    {
        private int _value;
        public int Value
        {
            get { return _value; }
            set
            {
                int v = value;
                if (v < 0) v = 0;
                if (v > 100) v = 100;
                if (v != _value) { _value = v; Invalidate(); }
            }
        }
        public Bar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle track = new Rectangle(0, 0, Width, Height);
            using (GraphicsPath p = Round(track, Height / 2)) using (SolidBrush b = new SolidBrush(Color.FromArgb(42, 46, 60)))
                g.FillPath(b, p);
            int w = (int)((Width - 1) * (_value / 100.0));
            if (w > 0)
            {
                Rectangle fill = new Rectangle(0, 0, Math.Max(Height, w), Height);
                using (LinearGradientBrush b = new LinearGradientBrush(
                    new Rectangle(0, 0, Math.Max(1, Width), Math.Max(1, Height)), Cfg.AccentA, Cfg.AccentB, 0f))
                using (GraphicsPath p = Round(fill, Height / 2))
                    g.FillPath(b, p);
            }
        }
        private static GraphicsPath Round(Rectangle r, int rad)
        {
            GraphicsPath p = new GraphicsPath();
            int d = Math.Max(1, rad * 2);
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }
}
