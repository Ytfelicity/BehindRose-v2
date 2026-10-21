using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using BehindRose.Windows;

namespace BehindRose.Desktop;

public partial class App : Application
{
    [STAThread]
    public static void Main(string[] args)
    {
        Velopack.VelopackApp.Build().SetAutoApplyOnStartup(false).Run();
        var app = new App(); app.InitializeComponent(); app.Run();
    }
    private Mutex? instance;
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.FirstOrDefault() == "--worker") { Shutdown(Worker.Run(e.Args)); return; }
        DevelopmentMode.Configure(e.Args);
        bool smoke = e.Args.Contains("--smoke-test") || e.Args.Contains("--connectivity-check"), updateTest = e.Args.Contains("--update-test");
        bool demo = smoke || updateTest || e.Args.Contains("--demo");
        if (WindowsState.IsAdministrator && !demo)
        { MessageBox.Show("请普通双击启动。只有应用修复和恢复备份时才需要管理员权限。", "启动方式"); Shutdown(); return; }
        instance = new Mutex(true, @"Local\BehindRose-v2-" + WindowsState.UserSid + (DevelopmentMode.Enabled ? "-dev" : "") + (smoke ? "-smoke" : demo ? "-demo" : ""), out bool first);
        if (!first) { if (smoke) { Shutdown(1); return; } MessageBox.Show("程序已经打开，请使用原来的窗口。", "身后红玫瑰"); Shutdown(); return; }
        DispatcherUnhandledException += (_, args) =>
        {
            MessageBox.Show("操作未完成：" + args.Exception.Message + "\n如有配置操作中断，请重新打开程序检查备份记录。", "操作未完成"); args.Handled = true;
        };
        Window window = e.Args.Contains("--legacy-ui") ? new MainWindow(demo, smoke, updateTest) : new WorkbenchWindow(demo, smoke, updateTest);
        MainWindow = window; window.Show();
    }
    protected override void OnExit(ExitEventArgs e) { instance?.Dispose(); base.OnExit(e); }
}
