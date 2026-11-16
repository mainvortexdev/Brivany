using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Reflection;

[assembly: AssemblyTitle("Brivany")]
[assembly: AssemblyProduct("Brivany")]
[assembly: AssemblyCompany("Brivany")]
[assembly: AssemblyVersion("0.2.0.0")]
[assembly: AssemblyFileVersion("0.2.0.0")]
static class Launcher {
    static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    [STAThread] static int Main(string[] args) {
        try {
            string home=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var json=new JavaScriptSerializer();
            var selected=json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(home,"current.json")));
            string version=Convert.ToString(selected["version"]);
            if(!Regex.IsMatch(version,@"^\d+\.\d+\.\d+$"))throw new Exception("Versión instalada no válida.");
            string release=Path.Combine(home,"releases",version);
            string python=Path.Combine(release,"python","pythonw.exe");
            string script=Path.Combine(release,"app","desktop","distribution","entry.py");
            if(!File.Exists(python)||!File.Exists(script))throw new Exception("La instalación está incompleta. Ejecuta de nuevo el instalador.");
            var p=new ProcessStartInfo(python);
            p.UseShellExecute=false;p.CreateNoWindow=true;p.WorkingDirectory=Path.Combine(release,"app");
            p.Arguments="-I -B "+Quote(script);
            foreach(string arg in args)p.Arguments+=" "+Quote(arg);
            p.EnvironmentVariables["BRIVANY_INSTALL_DIR"]=home;
            p.EnvironmentVariables["BRIVANY_DATA_DIR"]=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Brivany","User Data");
            // Keep an explicit isolated directory for automated package checks.
            string testData=Environment.GetEnvironmentVariable("BRIVANY_TEST_DATA_DIR");
            if(!String.IsNullOrEmpty(testData))p.EnvironmentVariables["BRIVANY_DATA_DIR"]=Path.GetFullPath(testData);
            p.EnvironmentVariables.Remove("PYTHONPATH");p.EnvironmentVariables.Remove("PYTHONHOME");
            p.EnvironmentVariables["PYTHONUTF8"]="1";
            using(var child=Process.Start(p)){child.WaitForExit();return child.ExitCode;}
        } catch(Exception e) { MessageBox.Show(e.Message,"Brivany",MessageBoxButtons.OK,MessageBoxIcon.Error);return 2; }
    }
}
