using Sample;
using Xunit;

namespace Sample.Tests;

public class ParityTests
{
    [Fact]
    public void ThreeIsOdd() => Assert.False(Parity.IsEven(3));

    [Fact]
    public void FourIsEven() => Assert.True(Parity.IsEven(4));
}
