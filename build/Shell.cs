// Nova Launcher 桌面外壳（C# 5 / WinForms + WebView2）
// 作用：把本地 Node 服务和界面装进一个独立窗口，用户不需要也不应该看到浏览器。
// 编译：csc /target:winexe /out:NovaLauncher.exe /reference:... Shell.cs
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NovaShell
{
    static class Cfg
    {
        public const string Title = "Nova Launcher · 新星启动器";
        public const int DefaultPort = 7420;
        public static readonly Color Bg = Color.FromArgb(11, 13, 21);
        public static readonly Color Text = Color.FromArgb(233, 236, 246);
        public static readonly Color TextMute = Color.FromArgb(140, 150, 172);
        public static readonly Color Bad = Color.FromArgb(251, 113, 133);
    }

    static class Program
    {
        private static Mutex _mutex = null;
        private static Process _server = null;

        [STAThread]
        private static void Main(string[] args)
        {
            bool created = false;
            try { _mutex = new Mutex(true, "NovaLauncher.Shell.Single", out created); }
            catch { created = true; }

            if (!created)
            {
                MessageBox.Show("Nova Launcher 已经在运行了。\n请查看任务栏。", "Nova Launcher",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Application.Run(new ShellForm(args));
            }
            finally
            {
                StopServer();
            }
        }

        public static void TrackServer(Process p) { _server = p; }

        public static void StopServer()
        {
            Process p = _server;
            _server = null;
            if (p == null) return;
            try
            {
                if (!p.HasExited)
                {
                    p.Kill();
                    p.WaitForExit(3000);
                }
            }
            catch { }
        }
    }

    class ShellForm : Form
    {
        private WebView2 _wv;
        private Panel _splash;
        private Label _splashTitle;
        private Label _splashStatus;
        private Process _server;
        private readonly string _root;
        private readonly string _dataDir;
        private readonly bool _devMode;
        private int _port = Cfg.DefaultPort;
        private bool _ready;

        public ShellForm(string[] args)
        {
            _root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            _dataDir = Path.Combine(_root, "data");
            _devMode = Array.IndexOf(args, "--dev") >= 0;
            if (Array.IndexOf(args, "--port") >= 0)
            {
                int i = Array.IndexOf(args, "--port");
                if (i + 1 < args.Length)
                {
                    int v;
                    if (int.TryParse(args[i + 1], out v) && v > 0 && v < 65536) _port = v;
                }
            }
            InitUi();
            Load += async delegate { await BootAsync(); };
            // 确保窗口出现在前台（从外壳进程创建时偶发会被系统放到后台）
            Shown += delegate { Activate(); BringToFront(); };
            Activated += delegate { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; };
            FormClosing += delegate
            {
                SaveWindowPrefs();
                Program.StopServer();
            };
        }

        /* ------------------------------------------------------------ UI */

        private void InitUi()
        {
            Text = Cfg.Title;
            BackColor = Cfg.Bg;
            ForeColor = Cfg.Text;
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(940, 640);
            ClientSize = new Size(1280, 820);
            DoubleBuffered = true;
            try
            {
                string ico = Path.Combine(_root, "nova.ico");
                if (File.Exists(ico)) Icon = new Icon(ico);
            }
            catch { }
            RestoreWindowPrefs();

            // 启动遮罩（服务就绪前显示，避免白屏）
            _splash = new Panel();
            _splash.Dock = DockStyle.Fill;
            _splash.BackColor = Cfg.Bg;
            Controls.Add(_splash);

            _splashTitle = new Label();
            _splashTitle.Text = "Nova Launcher";
            _splashTitle.Font = new Font("Microsoft YaHei UI", 24f, FontStyle.Bold);
            _splashTitle.ForeColor = Cfg.Text;
            _splashTitle.AutoSize = true;
            _splashTitle.BackColor = Color.Transparent;
            _splash.Controls.Add(_splashTitle);

            _splashStatus = new Label();
            _splashStatus.Text = "正在启动本地服务…";
            _splashStatus.Font = new Font("Microsoft YaHei UI", 9.5f);
            _splashStatus.ForeColor = Cfg.TextMute;
            _splashStatus.AutoSize = true;
            _splashStatus.BackColor = Color.Transparent;
            _splash.Controls.Add(_splashStatus);

            _splash.Resize += delegate { LayoutSplash(); };
            LayoutSplash();
        }

        private void LayoutSplash()
        {
            if (_splashTitle == null) return;
            int cx = _splash.Width / 2;
            int cy = _splash.Height / 2;
            _splashTitle.Location = new Point(cx - _splashTitle.Width / 2, cy - 40);
            _splashStatus.Location = new Point(cx - _splashStatus.Width / 2, cy + 16);
        }

        private void SetStatus(string text)
        {
            if (_splashStatus == null || _splashStatus.IsDisposed) return;
            _splashStatus.Text = text;
            LayoutSplash();
        }

        /* ------------------------------------------------------- 启动流程 */

        private async System.Threading.Tasks.Task BootAsync()
        {
            try
            {
                string url = "http://127.0.0.1:" + _port + "/";

                if (!_devMode && !IsPortOpen(_port))
                {
                    SetStatus("正在启动本地服务…");
                    if (!StartServer())
                    {
                        ShowFatal("本地服务启动失败。",
                            "没有找到 Node 运行时，或服务无法启动。\n\n"
                            + "请确认安装完整（安装目录下应有 runtime\\node.exe），\n"
                            + "或重新运行安装程序修复。");
                        return;
                    }
                }

                SetStatus("等待服务就绪…");
                if (!WaitForPort(_port, 30000))
                {
                    ShowFatal("本地服务没有响应。",
                        "服务已启动但端口 " + _port + " 一直没有响应。\n\n"
                        + "可能是端口被其他程序占用，或首次启动被杀毒软件拦截。\n"
                        + "可以尝试用 --port 7500 参数另行启动。");
                    return;
                }

                SetStatus("正在加载界面…");
                await InitWebViewAsync(url);
            }
            catch (Exception ex)
            {
                ShowFatal("启动失败", ex.Message);
            }
        }

        private bool StartServer()
        {
            string nodeExe = Path.Combine(_root, "runtime", "node.exe");
            if (!File.Exists(nodeExe)) nodeExe = Path.Combine(_root, "node.exe");
            string entry = Path.Combine(_root, "app", "server", "index.mjs");
            if (!File.Exists(entry)) entry = Path.Combine(_root, "server", "index.mjs");
            if (!File.Exists(nodeExe)) nodeExe = "node"; if (!File.Exists(entry)) return false;

            ProcessStartInfo psi = new ProcessStartInfo(nodeExe, "\"" + entry + "\"");
            psi.WorkingDirectory = Path.GetDirectoryName(entry);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            // 外壳负责开窗口，别再让服务自己弹浏览器
            psi.EnvironmentVariables["NOVA_NO_OPEN"] = "1";
            psi.EnvironmentVariables["NOVA_PORT"] = _port.ToString();
            try { psi.EnvironmentVariables["NOVA_DATA_DIR"] = _dataDir; } catch { }

            try
            {
                _server = Process.Start(psi);
                // 必须持续消费输出，否则管道写满会把子进程卡死
                _server.OutputDataReceived += delegate { };
                _server.ErrorDataReceived += delegate { };
                _server.BeginOutputReadLine();
                _server.BeginErrorReadLine();
                Program.TrackServer(_server);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool IsPortOpen(int port)
        {
            try
            {
                using (TcpClient c = new TcpClient())
                {
                    IAsyncResult ar = c.BeginConnect("127.0.0.1", port, null, null);
                    bool ok = ar.AsyncWaitHandle.WaitOne(400);
                    if (ok && c.Connected)
                    {
                        c.EndConnect(ar);
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        private bool WaitForPort(int port, int timeoutMs)
        {
            Stopwatch sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (IsPortOpen(port)) return true;
                if (_server != null && _server.HasExited) return false;
                Thread.Sleep(200);
            }
            return false;
        }

        /* ------------------------------------------------------- WebView2 */

        private async System.Threading.Tasks.Task InitWebViewAsync(string url)
        {
            _wv = new WebView2();
            _wv.Dock = DockStyle.Fill;
            _wv.DefaultBackgroundColor = Cfg.Bg;
            Controls.Add(_wv);
            _wv.BringToFront();

            // 缓存/本地存储放 data 目录，这样主题等本地设置能持久保存
            string userData = Path.Combine(_dataDir, "webview2");
            try { Directory.CreateDirectory(userData); } catch { }

            CoreWebView2Environment env = null;
            try
            {
                CoreWebView2EnvironmentOptions opt = new CoreWebView2EnvironmentOptions("--disable-features=msWebOOUI,msPdfOOUI");
                env = await CoreWebView2Environment.CreateAsync(null, userData, opt);
                await _wv.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                ShowFatal("无法初始化内置浏览器内核（WebView2）",
                    "系统缺少 WebView2 运行时。\n\n"
                    + "Windows 11 与较新的 Windows 10 通常自带；若缺失，请安装：\n"
                    + "https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\n"
                    + "详细信息：" + ex.Message);
                return;
            }

            CoreWebView2 core = _wv.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreDevToolsEnabled = true;         // F12 调试，方便排查
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;

            // 站外链接（官网/MC百科）一律交给系统浏览器，不在启动器里打开
            core.NewWindowRequested += delegate (object s, CoreWebView2NewWindowRequestedEventArgs e)
            {
                e.Handled = true;
                OpenExternal(e.Uri);
            };
            core.NavigationStarting += delegate (object s, CoreWebView2NavigationStartingEventArgs e)
            {
                string target = e.Uri ?? "";
                if (target.StartsWith("http://127.0.0.1:" + _port) || target.StartsWith("http://localhost:" + _port))
                    return;
                if (target.StartsWith("http://") || target.StartsWith("https://") || target.StartsWith("mailto:"))
                {
                    e.Cancel = true;
                    OpenExternal(target);
                }
            };

            core.Navigate(url);
            _ready = true;

            // 首次渲染完成后移除遮罩
            core.NavigationCompleted += delegate (object s, CoreWebView2NavigationCompletedEventArgs e)
            {
                System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
                t.Interval = 120;
                t.Tick += delegate
                {
                    t.Stop();
                    t.Dispose();
                    if (_splash != null && !_splash.IsDisposed)
                    {
                        Controls.Remove(_splash);
                        _splash.Dispose();
                        _splash = null;
                    }
                };
                t.Start();
            };
        }

        private static void OpenExternal(string url)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("rundll32", "url.dll,FileProtocolHandler " + url);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process.Start(psi);
            }
            catch { }
        }

        /* ------------------------------------------------------- 错误提示 */

        private void ShowFatal(string title, string detail)
        {
            if (_splash == null)
            {
                _splash = new Panel();
                _splash.Dock = DockStyle.Fill;
                _splash.BackColor = Cfg.Bg;
                Controls.Add(_splash);
                _splash.BringToFront();
            }
            _splash.Controls.Clear();

            Label t = new Label();
            t.Text = title;
            t.Font = new Font("Microsoft YaHei UI", 14f, FontStyle.Bold);
            t.ForeColor = Cfg.Bad;
            t.AutoSize = true;
            t.BackColor = Color.Transparent;
            _splash.Controls.Add(t);

            Label d = new Label();
            d.Text = detail;
            d.Font = new Font("Microsoft YaHei UI", 9.5f);
            d.ForeColor = Cfg.TextMute;
            d.AutoSize = false;
            d.BackColor = Color.Transparent;
            d.Size = new Size(Math.Min(720, _splash.Width - 80), 260);
            _splash.Controls.Add(d);

            Button close = new Button();
            close.Text = "关闭";
            close.FlatStyle = FlatStyle.Flat;
            close.BackColor = Color.FromArgb(30, 33, 44);
            close.ForeColor = Cfg.Text;
            close.FlatAppearance.BorderColor = Color.FromArgb(60, 65, 80);
            close.Size = new Size(96, 32);
            close.Click += delegate { Close(); };
            _splash.Controls.Add(close);

            int cx = _splash.Width / 2;
            t.Location = new Point(cx - t.PreferredWidth / 2, 60);
            d.Location = new Point(cx - d.Width / 2, 110);
            close.Location = new Point(cx - 48, 110 + d.Height + 16);
        }

        /* ------------------------------------------------------- 窗口记忆 */

        private string PrefsFile
        {
            get { return Path.Combine(_dataDir, "shell-window.txt"); }
        }

        private void RestoreWindowPrefs()
        {
            try
            {
                if (!File.Exists(PrefsFile)) return;
                string[] parts = File.ReadAllText(PrefsFile).Split(',');
                if (parts.Length < 4) return;
                int w = int.Parse(parts[0]), h = int.Parse(parts[1]);
                int x = int.Parse(parts[2]), y = int.Parse(parts[3]);
                if (w < 940 || h < 640) return;
                Rectangle screen = Screen.PrimaryScreen.WorkingArea;
                if (x < -w + 200 || y < -h + 200 || x > screen.Right - 200 || y > screen.Bottom - 200) return;
                StartPosition = FormStartPosition.Manual;
                Bounds = new Rectangle(x, y, w, h);
            }
            catch { }
        }

        private void SaveWindowPrefs()
        {
            try
            {
                if (WindowState != FormWindowState.Normal) return;
                if (!Directory.Exists(_dataDir)) Directory.CreateDirectory(_dataDir);
                File.WriteAllText(PrefsFile, string.Format("{0},{1},{2},{3}",
                    Bounds.Width, Bounds.Height, Bounds.X, Bounds.Y));
            }
            catch { }
        }
    }
}
