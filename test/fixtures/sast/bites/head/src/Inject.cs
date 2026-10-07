using System.Diagnostics;

public class Runner
{
    public void Run(string userInput)
    {
        Process proc = new Process();
        proc.StartInfo.FileName = "cmd.exe";
        proc.StartInfo.Arguments = "/c dir " + userInput;
        proc.Start();
    }
}
