// A small .NET solution that reaches SharePoint through TWO clients -- Graph
// for its document library, CSOM for its lists -- plus EF Core over SQL
// Server, a Redis connection, a Service Bus sender, a standard composition
// root, central package management and a shared build file. Every name is the
// real one a .NET team would write, because the analysers under test are the
// pack's, and the pack is where real names belong.
//
// It is data for the suite, never a consuming project: nothing in it is run.
const project = (sdk, body) => `<Project Sdk="${sdk}">\n${body}\n</Project>\n`;

export const SHAREPOINT = {
  "global.json": JSON.stringify({ sdk: { version: "8.0.100" } }),
  "Directory.Packages.props": project("", `  <ItemGroup>
    <PackageVersion Include="Microsoft.Graph" Version="5.56.0" />
    <PackageVersion Include="Microsoft.SharePointOnline.CSOM" Version="16.1.24000.12000" />
    <PackageVersion Include="Npgsql" Version="8.0.0" />
    <PackageVersion Include="Some.Internal.Sdk" Version="1.0.0" />
  </ItemGroup>`),
  "Directory.Build.props": project("", `  <ItemGroup>
    <PackageReference Include="Serilog" />
  </ItemGroup>`),
  "src/Api/Api.csproj": project("Microsoft.NET.Sdk.Web", `  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\\Infrastructure\\Infrastructure.csproj" />
  </ItemGroup>`),
  "src/Api/Program.cs": `var builder = WebApplication.CreateBuilder(args);
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Main")));
var app = builder.Build();
app.Run();
`,
  "src/Infrastructure/Infrastructure.csproj": project("Microsoft.NET.Sdk", `  <PropertyGroup><TargetFrameworks>net8.0;net9.0</TargetFrameworks></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Graph" />
    <PackageReference Include="Microsoft.SharePointOnline.CSOM" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8.0.0" />
    <PackageReference Include="StackExchange.Redis" Version="2.7.0" />
    <PackageReference Include="Azure.Messaging.ServiceBus" Version="7.17.0" />
    <PackageReference Include="Acme.Internal.Widgets" Version="3.1.0" />
  </ItemGroup>`),
  "src/Infrastructure/DependencyInjection.cs": `using Microsoft.Extensions.DependencyInjection;
namespace Contoso.Infrastructure;
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        // services.AddScoped<IOldThing, OldThing>(); is commented out and is not a registration
        services.AddScoped<IGraphDriveService, GraphDriveService>();
        services.AddScoped<ICsomListService, CsomListService>();
        services.AddSingleton<ICacheLock, RedisCacheLock>();
        services.AddTransient<IOrderPublisher, OrderPublisher>();
        services.AddHttpClient("github", c => c.BaseAddress = new Uri("https://user:hunter2@example.test/"));
        services.Configure<GraphOptions>(config.GetSection("Graph"));
        return services;
    }
}
`,
  "src/Infrastructure/SharePoint/GraphDriveService.cs": `using Microsoft.Graph;
using Microsoft.Graph.Models;
namespace Contoso.Infrastructure.SharePoint;
public class GraphDriveService : IGraphDriveService
{
    private readonly GraphServiceClient _client;
    public GraphDriveService(GraphServiceClient client) => _client = client;
    public async Task<DriveItem?> Upload(string siteId, string path, Stream content)
    {
        var drive = await _client.Sites[siteId].Drive.GetAsync();
        return await _client.Drives[drive!.Id].Root.ItemWithPath(path).Content.PutAsync(content);
    }
}
`,
  "src/Infrastructure/SharePoint/CsomListService.cs": `using Microsoft.SharePoint.Client;
namespace Contoso.Infrastructure.SharePoint;
public class CsomListService : ICsomListService
{
    public IEnumerable<ListItem> Items(ClientContext ctx, string title)
    {
        var list = ctx.Web.Lists.GetByTitle(title);
        var items = list.GetItems(CamlQuery.CreateAllItemsQuery());
        ctx.Load(items);
        ctx.ExecuteQuery();
        return items;
    }
}
`,
  "src/Infrastructure/Data/AppDbContext.cs": `using Microsoft.EntityFrameworkCore;
namespace Contoso.Infrastructure.Data;
public class AppDbContext : DbContext
{
    public DbSet<Order> Orders => Set<Order>();
}
`,
  "src/Infrastructure/Caching/RedisCacheLock.cs": `using StackExchange.Redis;
namespace Contoso.Infrastructure.Caching;
public class RedisCacheLock : ICacheLock
{
    private readonly IConnectionMultiplexer _redis;
    public RedisCacheLock(IConnectionMultiplexer redis) => _redis = redis;
    // "Server=db;Password=hunter2" in a comment is not read
    private const string Conn = "Server=cache;Password=hunter2";
}
`,
  "src/Infrastructure/Messaging/OrderPublisher.cs": `using Azure.Messaging.ServiceBus;
namespace Contoso.Infrastructure.Messaging;
public class OrderPublisher : IOrderPublisher
{
    private readonly ServiceBusSender _sender;
    public Task Publish(Order o) => _sender.SendMessageAsync(new ServiceBusMessage(o.Id));
}
`,
  "src/Worker/Worker.csproj": project("Microsoft.NET.Sdk.Worker", `  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Graph" />
  </ItemGroup>`),
  "src/Worker/Unused.cs": "namespace Contoso.Worker; public class Unused { }\n",
  "docs/notes.md": "GraphServiceClient is mentioned in a document, which is not code.\n",
};
