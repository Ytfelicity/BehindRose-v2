using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shell;
using ShapePath = System.Windows.Shapes.Path;

namespace BehindRose.Desktop;

internal sealed partial class WorkbenchWindow
{
    private readonly Grid captionBar = new() { Height = 36, Background = new SolidColorBrush(Color.FromRgb(10, 10, 10)) };
    private Button maximizeButton = null!;

    private void ConfigureChrome()
    {
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.CanResize;
        WindowChrome.SetWindowChrome(this, new WindowChrome
        {
            CaptionHeight = 36, ResizeBorderThickness = new Thickness(6),
            GlassFrameThickness = new Thickness(0), CornerRadius = new CornerRadius(0), UseAeroCaptionButtons = false
        });
        captionBar.ColumnDefinitions.Add(new ColumnDefinition());
        captionBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var brand = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(14, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        brand.Children.Add(new Image { Source = Icon, Width = 16, Height = 16, Margin = new Thickness(0, 0, 9, 0) });
        brand.Children.Add(new TextBlock { Text = "Rose in my wake", Foreground = Brushes.Gainsboro, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
        brand.Children.Add(new TextBlock { Text = MainWindow.AppVersion, Foreground = new SolidColorBrush(Color.FromRgb(116, 116, 116)), FontSize = 11, Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
        captionBar.Children.Add(brand);
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        actions.Children.Add(CaptionButton("最小化", "M 1,6 L 11,6", () => SystemCommands.MinimizeWindow(this)));
        maximizeButton = CaptionButton("最大化", "M 1,1 L 11,1 11,11 1,11 Z", () =>
        {
            if (WindowState == WindowState.Maximized) SystemCommands.RestoreWindow(this);
            else SystemCommands.MaximizeWindow(this);
        });
        actions.Children.Add(maximizeButton);
        actions.Children.Add(CaptionButton("关闭", "M 1,1 L 11,11 M 11,1 L 1,11", () => SystemCommands.CloseWindow(this), true));
        Grid.SetColumn(actions, 1); captionBar.Children.Add(actions);
        var layout = new Grid();
        layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        layout.RowDefinitions.Add(new RowDefinition());
        layout.Children.Add(captionBar); Grid.SetRow(browser, 1); layout.Children.Add(browser); Content = layout;
        StateChanged += (_, _) =>
        {
            bool maximized = WindowState == WindowState.Maximized;
            string label = maximized ? "还原" : "最大化";
            AutomationProperties.SetName(maximizeButton, label); maximizeButton.ToolTip = label;
            ((ShapePath)maximizeButton.Content).Data = Geometry.Parse(maximized ? "M 3,1 L 11,1 11,9 M 1,3 L 9,3 9,11 1,11 Z" : "M 1,1 L 11,1 11,11 1,11 Z");
        };
        SourceInitialized += (_, _) =>
        {
            nint handle = new WindowInteropHelper(this).Handle;
            uint dark = 1, noBorder = 0xfffffffe;
            _ = DwmSetWindowAttribute(handle, 20, ref dark, 4);
            _ = DwmSetWindowAttribute(handle, 34, ref noBorder, 4);
        };
    }

    private static Button CaptionButton(string name, string geometry, Action action, bool close = false)
    {
        var button = new Button
        {
            Width = 46, Height = 36, Foreground = Brushes.Gainsboro,
            BorderThickness = new Thickness(0), Padding = new Thickness(0), Focusable = false, ToolTip = name,
            Content = new ShapePath { Data = Geometry.Parse(geometry), Stroke = Brushes.Gainsboro, StrokeThickness = 1, Width = 12, Height = 12 }
        };
        var surface = new FrameworkElementFactory(typeof(Border));
        surface.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding(nameof(Button.Background)) { RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent) });
        var presenter = new FrameworkElementFactory(typeof(ContentPresenter));
        presenter.SetValue(HorizontalAlignmentProperty, HorizontalAlignment.Center); presenter.SetValue(VerticalAlignmentProperty, VerticalAlignment.Center);
        surface.AppendChild(presenter); button.Template = new ControlTemplate(typeof(Button)) { VisualTree = surface };
        var style = new Style(typeof(Button));
        style.Setters.Add(new Setter(BackgroundProperty, Brushes.Transparent));
        var hover = new Trigger { Property = IsMouseOverProperty, Value = true };
        hover.Setters.Add(new Setter(BackgroundProperty, new SolidColorBrush(close ? Color.FromRgb(196, 43, 28) : Color.FromRgb(35, 35, 35))));
        style.Triggers.Add(hover); button.Style = style;
        AutomationProperties.SetName(button, name); WindowChrome.SetIsHitTestVisibleInChrome(button, true);
        button.Click += (_, _) => action(); return button;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(nint window, int attribute, ref uint value, uint size);
}
